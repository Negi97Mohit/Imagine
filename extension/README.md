# Locked Image — POC

Bind any posted image URL to a custom interaction. Anyone with this
extension installed sees it wherever that image URL appears; anyone without
it just sees the plain image.

## What's new: custom interactions

The old hover effect was a single hardcoded "water reveal" class. Now:

- Anyone can write their own interaction as **HTML + CSS + JS** in the
  built-in editor, with a live preview.
- Interactions can be **saved locally** (private, `chrome.storage.local`)
  or **published globally** (Firestore `interactions` collection —
  browsable by anyone with the extension).
- Bindings store the full interaction inline, so any viewer can render it
  without a second lookup.
- The old water-reveal effect is now just the starter template the editor
  pre-fills — nothing was deleted, it's an example of the format.

### The `run()` contract

Every interaction's JS must define a global function:

```js
function run(canvas, img, config, root) {
  // canvas: a <canvas> the exact size of the bound image, already in the DOM
  // img:    the bound image, already loaded (naturalWidth/Height are set)
  // config: whatever JSON was saved alongside the interaction (optional)
  // root:   a plain <div> under the canvas, for interactions that want real HTML/CSS

  return {
    onPointerMove(x, y) {},
    resize(w, h) {},
    destroy() {},
  };
}
```

Open the editor (popup → Interaction → "Create new") to write one, with a
live preview against any image URL you paste in.

### Why a sandbox

This extension runs other people's JS, on every page you visit, whenever
you hover a bound image. If that ran with normal page access, a malicious
"interaction" could read cookies/session data off whatever site you're
viewing. So interactions never run in the content-script's context — they
run inside `sandbox.html`, declared under `"sandbox": { "pages": [...] }`
in the manifest and loaded via `sandbox="allow-scripts"` (no
`allow-same-origin`). That gives the iframe a unique **null origin**: it
can draw on its own canvas/DOM and load the bound image, but it has zero
access to the host page's DOM/cookies and zero access to any `chrome.*`
extension API. The content script only ever talks to it via
`postMessage`.

## How it all works

- **Popup** lets you paste the exact image URL you want to bind. As you
  type, it looks up and shows any interactions *other people* have already
  bound to that same URL — since this is a public POC, more than one
  person can bind the same image. Pick an interaction from your local
  library, the global gallery, or jump into the editor to create a new
  one, then "Bind this image" adds (or updates) *your* entry for that URL:
  `bindings/{hash(url)}.entries[] = [{id, name, html, css, js, boundAt}, …]`.
  A second "My Bindings" view lists the images you've bound from this
  browser, so you can swap in a different interaction or remove your
  binding — without touching anyone else's entry for the same image.
- **Editor** (`editor.html`, opens in a tab) is where interactions are
  authored: HTML/CSS/JS textareas, a live preview running in the same
  sandbox the real extension uses, "Save locally", and "Publish globally".
- **Content script** watches every page you visit for `<img>` tags, hashes
  each resolved `src` (`currentSrc` first — this matters for `srcset`
  images), and asks the background worker to look it up in Firestore. On a
  match, it does **not** touch the image — it just attaches a
  `pointerenter` listener. The image looks completely normal until
  hovered.
- **On hover**, a sandboxed `<iframe>` is created fresh, appended directly
  to `<body>`, `position: fixed`, synced to the image's live
  `getBoundingClientRect()` (kept in sync on scroll/resize). It's
  deliberately *not* inserted as a wrapper/sibling of the original image —
  that would inherit whatever layout CSS (object-fit, absolute
  positioning, transformed ancestors) the host page uses, which is what
  caused the earlier out-of-bounds bug. The iframe posts a `READY` message
  once loaded; the content script replies with `INIT` (image URL, size,
  and the interaction/config to run — if more than one person has bound
  this image, whichever entry was bound most recently is the one that
  plays).
- **On pointer-leave**, the sandbox detects its own `pointerleave` and
  messages the host to tear the iframe down — back to the plain, normal
  image. Nothing runs while idle.
- **Background worker** owns all Firestore REST calls for both
  collections (`bindings` and `interactions`) — content scripts and the
  editor never fetch Firestore directly.

## Setup (5 minutes)

1. **Create a Firebase project** at console.firebase.google.com (or reuse
   an existing one).
2. **Enable Firestore** (Build → Firestore Database → Create database →
   start in **test mode** for this POC — test mode allows public
   read/write, which is what lets the extension work without wiring up
   auth. Lock this down before using it for anything real; see below).
3. Open `background.js` and set:
   ```js
   const FIREBASE_PROJECT_ID = "your-project-id";
   ```
4. If you created Firestore in production mode, open Console → Firestore →
   Rules and use something like this for the POC (covers both
   collections used now):
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /bindings/{docId} {
         allow read, write: if true;
       }
       match /interactions/{docId} {
         allow read, write: if true;
       }
     }
   }
   ```
   Wide open on purpose — fine for a demo, tighten it before this goes
   anywhere real.
5. **Load the extension:** go to `chrome://extensions`, enable Developer
   Mode, click "Load unpacked," select this folder.

## Try it

1. Click the extension icon → "Create new" to write an interaction (or
   just pick the pre-seeded water-reveal template as-is) → save it locally
   or publish it globally.
2. Back in the popup, paste in the exact image URL you want to bind,
   select the interaction you just made, hit "Bind this image."
3. Visit any page where that exact image URL is loaded and hover it — it
   should morph into your interaction. Without the extension, the image
   just renders normally.

## Known POC limitations (expected, not bugs)

- **Exact URL match only.** If a platform rehosts/recompresses the image
  under a different URL (most social platforms do), the binding won't
  match. That's the perceptual-hashing problem from the earlier spec —
  intentionally out of scope for this POC.
- **Public write access.** Test-mode Firestore rules mean anyone can create
  bindings or publish interactions for any URL/name. Fine for a demo, not
  for shipping. Next step: require Firebase Auth on writes and restrict
  via security rules, or route writes through a Cloud Function you
  control.
- **No moderation on the global gallery.** Anyone can publish anything.
  Sandboxing prevents it from doing damage (no page/cookie/extension
  access), but it can still render whatever it wants inside its own
  bounds — treat the global gallery as public, unmoderated content.
- **"My Bindings" is local-only.** There's no auth in this POC, so
  Firestore can't tell who created a given binding — the popup's "My
  Bindings" list is just what you've bound from this specific browser
  profile, tracked in `chrome.storage.local`. A binding is still fully
  editable/removable by anyone who knows the image URL, via the same
  "Bind this image" flow.
