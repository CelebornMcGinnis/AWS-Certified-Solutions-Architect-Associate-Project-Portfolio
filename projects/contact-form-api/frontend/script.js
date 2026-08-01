(() => {
  const defaultConfig = {
    apiEndpoint: "",
    apiKey: "",
    headers: {},
    redirectOnSuccess: true,
    successUrl: "success.html",
    requestTimeoutMs: 10000
  };

  const config = {
    ...defaultConfig,
    ...(window.APP_CONFIG || {})
  };

  const year = document.querySelector("#year");
  const form = document.querySelector("#contact-form");
  const status = document.querySelector("#form-status");
  const submitButton = document.querySelector("#submit-button");

  if (year) {
    year.textContent = new Date().getFullYear();
  }

  if (!form) {
    return;
  }

  const setStatus = (message, type = "info") => {
    if (!status) return;
    status.textContent = message;
    status.className = `form-status ${type}`;
    status.hidden = false;
  };

  const clearStatus = () => {
    if (!status) return;
    status.textContent = "";
    status.hidden = true;
  };

  const isConfiguredEndpoint = (endpoint) => {
    return Boolean(
      endpoint &&
      endpoint.startsWith("https://") &&
      !endpoint.includes("YOUR_API_ID") &&
      !endpoint.includes("YOUR_REGION") &&
      !endpoint.includes("YOUR_STAGE")
    );
  };

  const value = (formData, fieldName) => {
    return (formData.get(fieldName) || "").toString().trim();
  };

  // The form is a one-field "smoke test" (email + consent only) — no
  // name/subject/message to collect. Keep this in sync with the Lambda's
  // own payload.get(...) calls in aws/lambda/lambda_function.py if the
  // form ever gains or loses fields.
  const buildPayload = (formData) => {
    return {
      email: value(formData, "email"),
      consent: formData.get("consent") === "yes",
      metadata: {
        submittedAt: new Date().toISOString(),
        pageUrl: window.location.href,
        userAgent: window.navigator.userAgent
      }
    };
  };

  const buildHeaders = () => {
    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      ...(config.headers || {})
    };

    if (config.apiKey) {
      headers["x-api-key"] = config.apiKey;
    }

    return headers;
  };

  const setSubmitting = (isSubmitting) => {
    if (!submitButton) return;
    submitButton.disabled = isSubmitting;
    submitButton.textContent = isSubmitting ? "Sending..." : "Send message";
  };

  const parseResponseBody = async (response) => {
    const text = await response.text();
    if (!text) return {};

    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();

    if (!form.reportValidity()) {
      return;
    }

    if (!isConfiguredEndpoint(config.apiEndpoint)) {
      setStatus("Add your deployed AWS API Gateway POST URL in config.js before submitting.", "error");
      return;
    }

    const formData = new FormData(form);

    // Bot filled the hidden honeypot field. Pretend success without sending anything.
    if (value(formData, "website")) {
      form.reset();
      setStatus("Thanks! Your message was received.", "success");
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), config.requestTimeoutMs);

    setSubmitting(true);
    setStatus("Sending your message...", "info");

    try {
      const response = await fetch(config.apiEndpoint, {
        method: "POST",
        mode: "cors",
        headers: buildHeaders(),
        body: JSON.stringify(buildPayload(formData)),
        signal: controller.signal
      });

      const responseBody = await parseResponseBody(response);

      if (!response.ok) {
        // The Lambda sends error text under "error" (see aws/lambda/lambda_function.py),
        // not "message" — check both so a real reason surfaces instead of the generic fallback.
        throw new Error(responseBody.error || responseBody.message || `Request failed with status ${response.status}.`);
      }

      form.reset();

      const successMessage = responseBody.message || "Thanks! Your message was received.";
      setStatus(successMessage, "success");

      if (config.redirectOnSuccess) {
        window.setTimeout(function () {
          window.location.assign(config.successUrl);
        }, 1000);
      }
    } catch (error) {
      const message = error.name === "AbortError"
        ? "The request timed out. Please try again."
        : error.message || "Something went wrong. Please try again.";

      setStatus(message, "error");
    } finally {
      window.clearTimeout(timeoutId);
      setSubmitting(false);
    }
  });
})();
