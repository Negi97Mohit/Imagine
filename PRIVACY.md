# Privacy Policy for Open Sesame

**Last updated:** August 20, 2026

Open Sesame ("we", "our", or "the Extension") is committed to protecting your privacy. This Privacy Policy explains how our Chrome Extension collects, uses, and safeguards information when you use our service.

---

## 1. Single Purpose & Overview

Open Sesame's sole purpose is to provide a shared, interactive layer over images across the web by recognizing images based on their visual fingerprint (content-first recognition) rather than their specific host URL.

---

## 2. Information We Process and Collect

### A. Visual Image Signatures & Fingerprints
- When you interact with or scan an image, the extension computes a cryptographic or perceptual hash of the image locally on your device.
- This visual signature is transmitted to our servers solely to check for, retrieve, or associate existing annotations, tags, and interactive layers.
- We do not store or transmit raw copies of full web pages or non-image content.

### B. User-Generated Annotations & Content
- When you create notes, tags, comments, or interactive pins on an image, this content is stored to be displayed to you and other users interacting with that same visual asset.

### C. Authentication Information (If Account Creation is Used)
- If you create an account, we may store your email address, username, and encrypted credentials to manage your session and identify your contributed annotations.

### D. Local Storage Preferences
- We use your browser's local storage (`chrome.storage`) to save your local UI preferences (e.g., overlay visibility, theme settings, pinned status) and to cache recent visual lookups for performance optimization.

---

## 3. Information We DO NOT Collect

- **Browsing History:** We do not track, log, or record the websites, URLs, or search queries you visit.
- **Personal Keystrokes & Form Inputs:** We do not monitor your typing, form inputs, or passwords on any webpage.
- **Sensitive Personal Data:** We do not collect health data, financial data, government identifiers, or biometric recognition data.
- **Third-Party Trackers:** We do not inject third-party advertising scripts or tracking pixels.

---

## 4. Permissions Justifications

In accordance with Google Chrome Web Store policies, Open Sesame requests only the minimum required permissions:

- **`storage`**: Used to save your personal preferences locally and maintain an offline cache of visual metadata.
- **Host Permissions (`<all_urls>` / Match Patterns)**: Required strictly to detect image elements and render the interactive overlay UI over matching visual elements on web pages you visit.

---

## 5. Remote Code Policy

Open Sesame **does not use or execute remote code**. All scripts, stylesheets, and logic are fully packaged and bundled locally within the extension package in compliance with Manifest V3 guidelines.

---

## 6. How We Use and Share Information

- **Service Delivery:** Data is processed exclusively to deliver the core functionality of Open Sesame—identifying images and displaying/storing community layers.
- **No Selling or Renting:** We do not sell, rent, monetize, or transfer your personal data or browsing activity to data brokers or third parties.
- **No Credit or Lending Evaluation:** We do not use user data for creditworthiness or lending decisions.

---

## 7. Data Retention & Deletion

- **Annotations & Content:** User-submitted annotations remain associated with the visual hash until deleted by the creator or removed in moderation.
- **Account Deletion:** You can request the complete deletion of your account and all associated contributions at any time by contacting us at the email below.

---

## 8. Security

We implement reasonable administrative and technical security measures, including TLS/HTTPS encryption in transit, to protect data against unauthorized access, alteration, or disclosure.

---

## 9. Changes to This Privacy Policy

We may update this Privacy Policy from time to time. Any changes will be posted in this document with an updated "Last updated" date.

---

## 10. Contact Us

If you have questions, feedback, or requests regarding this Privacy Policy or your data, please contact us:

- **Email:** support@opensesame.example.com *(or your personal / project contact email)*
- **GitHub Issues / Repository:** https://github.com/your-username/your-repo
