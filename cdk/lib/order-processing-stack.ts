import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { SITE_ORIGIN, BETA_SITE_ORIGIN } from './config';

const BACKEND_DIR = path.join(__dirname, '../../projects/order-processing/backend');

export interface OrderProcessingStackProps extends cdk.StackProps {
  stage: 'prod' | 'beta';
}

/**
 * Order processing demo: reserve inventory -> charge payment -> ship.
 * Unlike workflow-visualizer's state machine (which only ever advances
 * along a single happy path), this one demonstrates Step Functions'
 * other signature strength -- a Saga-style compensating transaction.
 * A visitor can opt in to a simulated payment failure, and the state
 * machine responds by releasing the inventory it already reserved
 * before marking the order failed, rather than leaving stock stuck in
 * limbo. Insufficient stock is a second, independently reachable
 * failure path that needs no compensation at all, since nothing was
 * reserved yet.
 *
 * Each Lambda task returns an ordinary `{success: true/false, ...}`
 * payload rather than raising on a business-logic failure, so the
 * state machine branches on a Choice state instead of ASL-level error
 * handling -- out-of-stock and a declined payment are expected
 * outcomes here, not exceptions.
 */
export class OrderProcessingStack extends cdk.Stack {
  public readonly apiEndpoint: string;

  constructor(scope: Construct, id: string, props: OrderProcessingStackProps) {
    super(scope, id, props);

    const { stage } = props;
    const namePrefix = stage === 'prod' ? 'order-processing' : 'order-processing-beta';
    const origin = stage === 'prod' ? SITE_ORIGIN : BETA_SITE_ORIGIN;
    // No real orders or real stock here either -- both stages tear down completely.
    const removalPolicy = cdk.RemovalPolicy.DESTROY;

    // --- Storage ---
    const ordersTable = new dynamodb.Table(this, 'OrdersTable', {
      partitionKey: { name: 'orderId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });
    ordersTable.addGlobalSecondaryIndex({
      indexName: 'OwnerIndex',
      partitionKey: { name: 'ownerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Holds only a live stock count per product -- the catalog's fixed
    // name/price data lives in code (backend/catalog.py), not here.
    // Each product's row is lazily seeded to its default stock the
    // first time it's ever reserved against, via a guarded conditional
    // put in reserve_inventory_handler.py.
    const inventoryTable = new dynamodb.Table(this, 'InventoryTable', {
      partitionKey: { name: 'productId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });

    // --- Step Functions task Lambdas ---
    const functionDefaults: Partial<lambda.FunctionProps> = {
      runtime: lambda.Runtime.PYTHON_3_13,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      code: lambda.Code.fromAsset(BACKEND_DIR),
    };

    const reserveInventoryFunction = new lambda.Function(this, 'ReserveInventoryFunction', {
      ...functionDefaults,
      handler: 'reserve_inventory_handler.lambda_handler',
      environment: { INVENTORY_TABLE: inventoryTable.tableName, ORDERS_TABLE: ordersTable.tableName },
    } as lambda.FunctionProps);
    inventoryTable.grantReadWriteData(reserveInventoryFunction);
    ordersTable.grantWriteData(reserveInventoryFunction);

    const chargePaymentFunction = new lambda.Function(this, 'ChargePaymentFunction', {
      ...functionDefaults,
      handler: 'charge_payment_handler.lambda_handler',
      environment: { ORDERS_TABLE: ordersTable.tableName },
    } as lambda.FunctionProps);
    ordersTable.grantWriteData(chargePaymentFunction);

    const releaseInventoryFunction = new lambda.Function(this, 'ReleaseInventoryFunction', {
      ...functionDefaults,
      handler: 'release_inventory_handler.lambda_handler',
      environment: { INVENTORY_TABLE: inventoryTable.tableName },
    } as lambda.FunctionProps);
    inventoryTable.grantWriteData(releaseInventoryFunction);

    // --- State machine ---
    const reserveInventoryTask = new tasks.LambdaInvoke(this, 'ReserveInventory', {
      lambdaFunction: reserveInventoryFunction,
      resultPath: '$.reserveResult',
      payloadResponseOnly: true,
    });
    const chargePaymentTask = new tasks.LambdaInvoke(this, 'ChargePayment', {
      lambdaFunction: chargePaymentFunction,
      resultPath: '$.paymentResult',
      payloadResponseOnly: true,
    });
    const releaseInventoryTask = new tasks.LambdaInvoke(this, 'ReleaseInventory', {
      lambdaFunction: releaseInventoryFunction,
      resultPath: '$.releaseResult',
      payloadResponseOnly: true,
    });

    const setOrderStatus = (id: string, status: string, failureReasonPath?: string) =>
      new tasks.DynamoUpdateItem(this, id, {
        table: ordersTable,
        key: { orderId: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.orderId')) },
        updateExpression: failureReasonPath
          ? 'SET #s = :s, failureReason = :r, updatedAt = :t'
          : 'SET #s = :s, updatedAt = :t',
        expressionAttributeNames: { '#s': 'status' },
        expressionAttributeValues: {
          ':s': tasks.DynamoAttributeValue.fromString(status),
          ':t': tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$$.State.EnteredTime')),
          ...(failureReasonPath ? { ':r': tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt(failureReasonPath)) } : {}),
        },
        resultPath: sfn.JsonPath.DISCARD,
      });

    const setShipped = setOrderStatus('SetShipped', 'SHIPPED');
    const setFailedInsufficientStock = setOrderStatus('SetFailedInsufficientStock', 'FAILED', '$.reserveResult.reason');
    const setFailedPaymentDeclined = setOrderStatus('SetFailedPaymentDeclined', 'FAILED', '$.paymentResult.reason');

    // No compensation needed here -- reserveInventoryTask only reaches
    // this branch when nothing was ever actually reserved.
    reserveInventoryTask.next(
      new sfn.Choice(this, 'WasInventoryReserved')
        .when(sfn.Condition.booleanEquals('$.reserveResult.success', true), chargePaymentTask)
        .otherwise(setFailedInsufficientStock),
    );

    // The compensating transaction: payment failed *after* inventory
    // was already reserved, so that reservation has to be undone
    // before the order can be marked failed.
    chargePaymentTask.next(
      new sfn.Choice(this, 'WasPaymentCharged')
        .when(sfn.Condition.booleanEquals('$.paymentResult.success', true), setShipped)
        .otherwise(releaseInventoryTask.next(setFailedPaymentDeclined)),
    );

    const stateMachine = new sfn.StateMachine(this, 'OrderStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(reserveInventoryTask),
      stateMachineType: sfn.StateMachineType.STANDARD,
      timeout: cdk.Duration.minutes(2),
    });

    // --- API Lambdas ---
    const createOrderFunction = new lambda.Function(this, 'CreateOrderFunction', {
      ...functionDefaults,
      handler: 'create_order_handler.lambda_handler',
      environment: {
        TABLE_NAME: ordersTable.tableName,
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
        ALLOWED_ORIGIN: origin,
      },
    } as lambda.FunctionProps);
    ordersTable.grantWriteData(createOrderFunction);
    stateMachine.grantStartExecution(createOrderFunction);

    const getOrderFunction = new lambda.Function(this, 'GetOrderFunction', {
      ...functionDefaults,
      handler: 'get_order_handler.lambda_handler',
      environment: { TABLE_NAME: ordersTable.tableName, ALLOWED_ORIGIN: origin },
    } as lambda.FunctionProps);
    ordersTable.grantReadData(getOrderFunction);

    const listMyOrdersFunction = new lambda.Function(this, 'ListMyOrdersFunction', {
      ...functionDefaults,
      handler: 'list_my_orders_handler.lambda_handler',
      environment: { TABLE_NAME: ordersTable.tableName, ALLOWED_ORIGIN: origin },
    } as lambda.FunctionProps);
    ordersTable.grantReadData(listMyOrdersFunction);

    const getCatalogFunction = new lambda.Function(this, 'GetCatalogFunction', {
      ...functionDefaults,
      handler: 'get_catalog_handler.lambda_handler',
      environment: { INVENTORY_TABLE: inventoryTable.tableName, ALLOWED_ORIGIN: origin },
    } as lambda.FunctionProps);
    inventoryTable.grantReadData(getCatalogFunction);

    // --- API ---
    const api = new apigwv2.HttpApi(this, 'OrdersApi', {
      apiName: namePrefix,
      corsPreflight: {
        allowOrigins: [origin],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        allowHeaders: ['Content-Type'],
      },
    });

    api.addRoutes({
      path: '/products',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetCatalogIntegration', getCatalogFunction),
    });
    api.addRoutes({
      path: '/orders',
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('CreateOrderIntegration', createOrderFunction),
    });
    api.addRoutes({
      path: '/orders/mine',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('ListMyOrdersIntegration', listMyOrdersFunction),
    });
    api.addRoutes({
      path: '/orders/{id}',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetOrderIntegration', getOrderFunction),
    });

    this.apiEndpoint = api.apiEndpoint;

    new cdk.CfnOutput(this, 'OrdersApiEndpoint', {
      description: 'Value to paste into projects/order-processing/frontend/config.js as apiBase',
      value: this.apiEndpoint,
    });
  }
}
