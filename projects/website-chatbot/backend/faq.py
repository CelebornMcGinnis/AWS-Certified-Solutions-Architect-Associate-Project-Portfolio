"""Deterministic FAQ layer, checked before any Bedrock call.

Entries are about this portfolio site itself -- a natural, honest thing
for a site chatbot to be asked about, and content that doesn't need an
AI model to answer correctly. Matching is deliberately simple (a
substring check against a keyword list): this is a demo of "cheap
deterministic answers first, AI as the fallback," not a real NLU
system.
"""
FAQ_ENTRIES = [
    {
        "keywords": ["cost", "price", "pricing", "expensive", "how much"],
        "answer": "Every project on this site runs on real, pay-per-use AWS services -- most stay well under $1/month at demo traffic levels. Each project page has its own Pricing section with a detailed cost breakdown.",
    },
    {
        "keywords": ["source", "code", "github", "repo", "repository"],
        "answer": "Every project's source code -- infrastructure and application -- is public on GitHub. You'll find a link in the footer of every page on this site.",
    },
    {
        "keywords": ["hire", "contact", "reach", "email", "linkedin", "get in touch"],
        "answer": "You can reach out through the Contact Form project on this site, or connect via the LinkedIn link in the footer.",
    },
    {
        "keywords": ["real aws", "mock", "fake", "simulated", "actually deployed", "is this live"],
        "answer": "Every project here runs on real, deployed AWS infrastructure -- nothing is mocked on the frontend. You're welcome to try one and watch the architecture work.",
    },
    {
        "keywords": ["how many project", "list of project", "what projects", "which projects"],
        "answer": "This site has several live and in-review AWS projects covering serverless APIs, WebSockets, Step Functions, Cognito auth, and GenAI with Bedrock. Check the Projects section on the homepage for the full list.",
    },
    {
        "keywords": ["cdk", "infrastructure as code", "terraform", "how is this deployed", "how do you deploy"],
        "answer": "Everything on this site is defined and deployed with the AWS CDK (TypeScript) -- no manual console clicking. Beta and production run as fully separate CDK stacks.",
    },
    {
        "keywords": ["tech stack", "technologies", "what aws services", "which aws services", "what services", "built with", "made with", "what's this built on"],
        "answer": "This site runs on real AWS services throughout: Lambda, API Gateway, DynamoDB, S3, and CloudFront on nearly every project, plus Cognito for auth, Bedrock (Nova Lite + Guardrails) for this chatbot and the summarizer, Step Functions for the order-processing and workflow-visualizer demos, and SNS/SQS/SES for the notification fan-out demo. Everything is deployed with the AWS CDK.",
    },
    {
        "keywords": ["movie poll", "polling app", "websocket poll", "live poll"],
        "answer": "The Movie Poll project is a real-time poll built on API Gateway WebSockets, Lambda, and DynamoDB -- votes broadcast to every open tab instantly, no page refresh or polling loop involved.",
    },
    {
        "keywords": ["image gallery", "moderated gallery", "photo gallery", "rekognition"],
        "answer": "The Moderated Image Gallery lets you upload a photo that's automatically scanned by Amazon Rekognition's content moderation API the moment it lands -- approved images join a public gallery, flagged ones are deleted immediately, no human review involved.",
    },
    {
        "keywords": ["habit tracker", "track a habit", "habit app"],
        "answer": "The Habit Tracker is an account-free demo -- it tracks daily check-ins and streaks against a random id stored in your browser, backed by a real DynamoDB table and API Gateway, no sign-up required.",
    },
    {
        "keywords": ["workflow visualizer", "step functions workflow", "state machine"],
        "answer": "The Workflow Visualizer submits a real AWS Step Functions execution and shows its state machine progressing live -- Validating, Processing, Complete -- straight from DynamoDB updates the state machine writes itself, no Lambda in that loop at all.",
    },
    {
        "keywords": ["order processing", "saga pattern", "step functions saga"],
        "answer": "Order Processing runs a Step Functions saga: reserve inventory, charge payment, ship -- and if you opt into a simulated payment failure, watch the state machine roll back the inventory reservation it already made instead of just erroring out.",
    },
    {
        "keywords": ["summarizer", "nova lite", "text summary", "summarize text"],
        "answer": "The Nova Lite Summarizer sends whatever text you paste to Amazon Bedrock's Nova Lite model for a real, live-generated summary -- short or detailed -- capped by a shared daily request budget so the demo can't run away in cost.",
    },
    {
        "keywords": ["sns fan-out", "fan-out demo", "sns notification"],
        "answer": "SNS Notification Fan-Out publishes one message to an SNS topic and fans it out down two independent paths at once -- a direct Lambda subscriber and a buffered SQS-backed one -- so you can watch both branches complete from a single click.",
    },
    {
        "keywords": ["contact form project", "smoke test form"],
        "answer": "The Contact Form project is a one-field smoke test -- submit an email and it kicks off a real POST to API Gateway, a Lambda function, and SES, landing a confirmation in your inbox.",
    },
    {
        "keywords": ["this chatbot", "how do you work", "how does this chatbot", "faq layer", "how were you built"],
        "answer": "This chatbot checks a small deterministic FAQ layer first -- instant, free answers for common questions like this one -- and falls back to Amazon Bedrock's Nova Lite model behind a Bedrock Guardrail for anything else, so every reply is tagged with which path answered it.",
    },
]


def match_faq(message):
    lowered = message.lower()
    for entry in FAQ_ENTRIES:
        if any(keyword in lowered for keyword in entry["keywords"]):
            return entry["answer"]
    return None
