# Architecture Diagrams

This directory contains Mermaid source files for the portfolio hosting path, custom error routing, and each AWS project.

| Diagram | File |
| --- | --- |
| Portfolio website, 404 routing, and project entry points | `portfolio-site.mmd` |
| Contact Form API | `contact-form-api.mmd` |
| Real-Time Polling App | `realtime-polling-app.mmd` |
| SNS Notification Fan-Out | `sns-notification-fan-out.mmd` |

## Viewing `.mmd` files

A standalone `.mmd` file is plain-text Mermaid source. Depending on the GitHub interface, opening it may show code rather than a rendered diagram. The project READMEs embed the same diagrams inside `mermaid` code fences, which GitHub renders visually.

Other preview options include:

- Open the file in Visual Studio Code with a Mermaid preview extension.
- Paste the source into the Mermaid Live Editor.
- Copy the source into a Markdown file inside a fenced `mermaid` block.

Do not rename an `.mmd` file to `.png`; it must be rendered or exported by a Mermaid-compatible tool to become an image.
