# mmkheyan

Official website of artist Meruzhan Mkheyan (paintings and sculptures).

**Live site:** https://nvberegovykh.github.io/mmkheyan/
**Admin panel:** https://nvberegovykh.github.io/mmkheyan/admin/

## Architecture

- **Hosting:** GitHub Pages (static site, this repo, branch `main`).
- **Content database:** [Firebase Firestore](https://console.firebase.google.com/project/mmkheyan-gallery) — collection `artworks` holds every painting/sculpture (name, description, size, material, technique, owner, image URL, display order). Document `settings/site` holds site-wide settings (contact link, default language, auto-translate toggle). Security rules allow public read, and require sign-in to write.
- **Image storage/CDN:** [Cloudinary](https://cloudinary.com) (cloud name `ttqojuw8`), using an unsigned upload preset `mmkheyan_unsigned` restricted to png/jpg/jpeg/webp, uploaded into the `mmkheyan` folder. Chosen over Firebase Storage because Firebase Storage now requires a paid Blaze billing plan even for light usage; Cloudinary's free tier covers this project.
- **Authentication:** Firebase Authentication (email/password) gates the admin panel. Only the signed-in admin account can write to Firestore.
- **Invisible watermark:** every image uploaded through the admin panel is watermarked client-side (`admin/watermark.js`) before it's sent to Cloudinary. It embeds a short copyright string into the least-significant bits of the Red/Green channels — invisible to the eye, but recoverable programmatically (`WATERMARK.extractWatermark(url)`), and always exported as PNG so the watermark isn't destroyed by re-compression.

## Editing content

Go to the admin panel, sign in, and use the form to add/edit/delete/reorder paintings and sculptures. Changes appear on the live site within seconds — no redeploy needed, since the public site reads directly from Firestore.

## Local development

This is a plain static site (no build step). Open `index.html` directly, or serve the folder with any static file server.
