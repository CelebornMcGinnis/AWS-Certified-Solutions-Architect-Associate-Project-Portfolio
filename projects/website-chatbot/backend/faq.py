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
]


def match_faq(message):
    lowered = message.lower()
    for entry in FAQ_ENTRIES:
        if any(keyword in lowered for keyword in entry["keywords"]):
            return entry["answer"]
    return None
