# The Apartment Dog — sales funnel

A 4-step funnel for the **50 Brain Games for the Apartment Dog** guide.

```
index.html      → sales page (ads point here)
checkout.html   → order form + £9 order bump (30-Day Plan)
upsell.html     → one-time offer (£19 Complete System)
thankyou.html   → delivery / download
style.css       → shared styling
assets/         → dog photos + "peek inside" previews
```

Messaging follows a value/transformation approach (sell the calm dog, not the PDF);
structure follows a classic hook → story → offer funnel with a stacked value slide,
guarantee, order bump, and one-time upsell.

---

## 1. Put it live on GitHub Pages (about 2 minutes)

1. Go to github.com → **New repository** → name it e.g. `apartment-dog` → **Public** → Create.
2. On the repo page: **Add file → Upload files**. Drag in **everything inside this folder**
   (index.html, checkout.html, upsell.html, thankyou.html, style.css, and the `assets` folder).
   Commit.
3. **Settings → Pages →** Source: *Deploy from a branch* → Branch: `main` / `/root` → Save.
4. Wait ~1 minute. Your page is live at `https://YOURNAME.github.io/apartment-dog/`.

That URL is what you point your ads at.

---

## 2. Wire up payments (the important bit)

Right now the buttons just move through the funnel (index → checkout → upsell → thankyou)
so you can see the flow. Static GitHub Pages can't take card payments by itself, so you
connect a checkout tool. Pick one:

- **Payhip** or **Gumroad** — easiest. Both host the whole checkout, deliver the file
  automatically, and support an order bump / upsell. Fastest way to launch.
- **Stripe Payment Links** — dead simple, but no native order bump. Good for a first test:
  point the main "Get instant access" button straight at your Stripe link.
- **ThriveCart** — the most powerful for bump + one-click upsell if you scale it.

**To connect:**
- On `index.html`, change every `href="checkout.html"` to your checkout URL (or keep
  `checkout.html` and put the real card fields / embed in it).
- On `thankyou.html`, replace `REPLACE_WITH_DOWNLOAD_LINK` — but ideally let your checkout
  tool deliver the file by email so the paid PDF isn't public.

**Important:** do **not** upload the paid guide PDF to this public repo — anyone could
download it for free. Deliver it through your checkout tool's secure delivery instead.

---

## 3. Easy edits

- **Brand name:** find/replace `The Indoor Dog Co.` across the files.
- **Price:** find `£14` (and the checkout total logic in `checkout.html`).
- **Photos:** swap anything in `assets/` — keep the same filenames.
- **Colours/fonts:** all in `style.css` at the top (`:root`).
