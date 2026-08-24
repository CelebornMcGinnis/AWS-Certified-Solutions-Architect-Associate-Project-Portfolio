"""Shared fixed product catalog for the order-processing demo.

Deliberately small and cheap (real e-commerce catalogs don't need to be
resizable for a portfolio demo), with low default stock per product so
running out is an easy, realistic failure case to actually trigger --
not just theoretical.
"""
CATALOG = {
    "widget-a": {"name": "Aluminum Widget", "unitPrice": 19.99, "defaultStock": 23},
    "widget-b": {"name": "Steel Bracket", "unitPrice": 12.50, "defaultStock": 15},
    "widget-c": {"name": "Titanium Bolt Set", "unitPrice": 34.00, "defaultStock": 3},
    "widget-d": {"name": "Carbon Fiber Panel", "unitPrice": 89.00, "defaultStock": 2},
}

MAX_QUANTITY_PER_ORDER = 10
