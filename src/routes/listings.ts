import { Hono } from "hono";
import {
  CATEGORIES,
  type CategoryKey,
  type Claim,
  type Listing,
  type ListingType,
  type User,
  createListing,
  getActiveListings,
  getClaimByListingAndClaimant,
  getClaimsForListing,
  getListingById,
  getPhotosForListing,
  getUserByNickname,
  addPhotoToListing,
  countListingsLast24h,
  RATE_LIMITS,
  updateListingFields,
} from "../db";
import { getCurrentUser, getTheme, HttpError, requireUser } from "../session";
import {
  categoryChips,
  errorPage,
  esc,
  html,
  layout,
  listingCard,
  raw,
  relativeAge,
  signupCard,
  userSignal,
} from "../views";
import { MAX_PHOTOS_PER_LISTING, savePhoto } from "../images";

// ---------- GET / (browse) ----------

export const browseRoute = new Hono();

browseRoute.get("/", (c) => {
  const user = getCurrentUser(c);
  const url = new URL(c.req.url);

  // Gate: signed-out visitors get only the signup card. No listings until they join.
  if (!user) {
    return c.html(layout({ title: "Join", user: null, body: signupCard(), theme: getTheme(c) }));
  }

  const cat = url.searchParams.get("cat") as CategoryKey | null;
  const validCat = cat && CATEGORIES.some((x) => x.key === cat) ? cat : null;

  const gives = getActiveListings("give", validCat ?? undefined);
  const gets = getActiveListings("get", validCat ?? undefined);
  const allListings = [...gives, ...gets];

  // Cache creator users and photos for each listing (each used twice — once for the
  // card, once for the modal).
  const creators = new Map<string, User>();
  const photosByListing = new Map<number, string[]>();
  for (const l of allListings) {
    const creator = creators.get(l.creator_nickname) ?? getUserByNickname(l.creator_nickname);
    if (creator) creators.set(creator.nickname, creator);
    photosByListing.set(l.id, getPhotosForListing(l.id));
  }

  const renderCol = (items: typeof gives, emptyLabel: string) =>
    items.length === 0
      ? html`<p><em>${emptyLabel}</em></p>`
      : items
          .map((l) => {
            const creator = creators.get(l.creator_nickname);
            if (!creator) return "";
            return listingCard(l, creator, photosByListing.get(l.id) ?? [], {
              hrefPrefix: "#l-",
              viewer: user,
            }).__raw;
          })
          .join("");

  const givesCol = renderCol(gives, "Nothing on offer yet. Be the first.");
  const getsCol = renderCol(gets, "Nobody's asked for anything yet.");

  const detailModals = renderListingModals(allListings, user, {
    creators,
    photos: photosByListing,
  });

  const body = html`
    <h2 class="gg-page-title">Town Ranch board</h2>
    <p class="gg-page-sub">Give what you have · Get what you need</p>
    <div class="feed-tabs">
      <input type="radio" name="feed-tab" id="tab-give" class="feed-tabs__radios" checked>
      <input type="radio" name="feed-tab" id="tab-get"  class="feed-tabs__radios">
      <nav class="feed-tabs__nav" aria-label="Give or Get">
        <label for="tab-give">Give</label>
        <label for="tab-get">Get</label>
      </nav>
      <div class="feed-cols">
        <section class="feed-cols__give">
          <h3>Give — things people share</h3>
          ${raw(givesCol)}
        </section>
        <section class="feed-cols__get">
          <h3>Get — things people need</h3>
          ${raw(getsCol)}
        </section>
      </div>
    </div>

    ${raw(modalWrap("new-listing", "New listing", newListingFormHtml("give")))}
    ${raw(detailModals)}
  `;

  const welcomeName = url.searchParams.has("welcome") ? user.nickname : undefined;
  return c.html(layout({
    title: "Browse",
    user,
    body,
    welcomeName,
    theme: getTheme(c),
    activeNav: "browse",
    filterBlade: { activeKey: validCat, chips: categoryChips(validCat, "give").__raw },
  }));
});

// ---------- GET/POST /new (create listing) ----------

export const newListingRoutes = new Hono();

export function editListingFormHtml(listing: Listing): string {
  return html`
    <form method="post" action="/l/${listing.id}/edit">
      <label>
        Title
        <input type="text" name="title" maxlength="80" required value="${listing.title}">
      </label>
      <label>
        Description
        <textarea name="description" maxlength="1000" rows="4" required>${listing.description}</textarea>
      </label>
      <div class="exchange-prompt">
        <label for="edit_exchange_hint_${listing.id}">
          <strong>In exchange — your side of the swap</strong>
          <small style="display:block;opacity:0.85;font-weight:normal;margin-top:0.2rem">
            GiveGet runs on reciprocity. Tell people what would make this feel fair.
          </small>
        </label>
        <input type="text" id="edit_exchange_hint_${listing.id}" name="exchange_hint" maxlength="200"
          value="${listing.exchange_hint ?? ""}"
          placeholder="e.g. fresh eggs · help in the garden · a thank-you note">
      </div>
      <button type="submit">Save changes</button>
    </form>
  `;
}

export function newListingFormHtml(defaultType: ListingType = "give"): string {
  const categoryOptions = CATEGORIES.map(
    (cat) => html`<option value="${cat.key}">${cat.label}</option>`
  ).join("");

  const typeButtons =
    defaultType === "give"
      ? html`
          <input type="radio" name="type" value="give" id="type_give" checked> <label for="type_give" style="display:inline">I want to <strong>give</strong> something</label><br>
          <input type="radio" name="type" value="get"  id="type_get"> <label for="type_get" style="display:inline">I want to <strong>get</strong> something</label>
        `
      : html`
          <input type="radio" name="type" value="give" id="type_give"> <label for="type_give" style="display:inline">I want to <strong>give</strong> something</label><br>
          <input type="radio" name="type" value="get"  id="type_get" checked> <label for="type_get" style="display:inline">I want to <strong>get</strong> something</label>
        `;

  return html`
    <form method="post" action="/new" enctype="multipart/form-data">
      <fieldset>
        ${raw(typeButtons)}
      </fieldset>

      <label>
        Category
        <select name="category" required>
          ${raw(categoryOptions)}
        </select>
      </label>

      <label>
        Title
        <input type="text" name="title" maxlength="80" required placeholder="e.g. Drill, can lend">
      </label>

      <label>
        Description
        <textarea name="description" maxlength="1000" rows="4" required
          placeholder="When it's available, condition, where to find you, etc."></textarea>
      </label>

      <div class="exchange-prompt">
        <label for="exchange_hint">
          <strong>In exchange — your side of the swap</strong>
          <small style="display:block;opacity:0.85;font-weight:normal;margin-top:0.2rem">
            GiveGet runs on reciprocity. If you're <strong>giving</strong>, say what would make
            this feel fair. If you're <strong>getting</strong>, say what you can offer back.
            Specific asks get more replies than "open to anything".
          </small>
        </label>
        <input type="text" id="exchange_hint" name="exchange_hint" maxlength="200"
          placeholder="e.g. fresh eggs · help in the garden · a thank-you note · nothing, just pay it forward">
      </div>

      <label>
        Photos (up to ${MAX_PHOTOS_PER_LISTING})
        <input type="file" name="photos" accept="image/*" multiple>
      </label>

      <button type="submit">Post it</button>
    </form>
  `;
}

newListingRoutes.get("/new", (c) => {
  const user = requireUser(c);
  const url = new URL(c.req.url);
  const defaultType = (url.searchParams.get("type") === "get" ? "get" : "give") as ListingType;

  const body = html`
    <article>
      <h2>New listing</h2>
      ${raw(newListingFormHtml(defaultType))}
    </article>
  `;

  return c.html(layout({ title: "New listing", user, body, theme: getTheme(c) }));
});

newListingRoutes.post("/new", async (c) => {
  const user = requireUser(c);

  if (countListingsLast24h(user.nickname) >= RATE_LIMITS.listings_per_day) {
    throw new HttpError(
      429,
      `You've created ${RATE_LIMITS.listings_per_day} listings in the last 24 hours. Wait a bit before posting more.`
    );
  }

  const form = await c.req.formData();
  const type = String(form.get("type") ?? "") as ListingType;
  const category = String(form.get("category") ?? "") as CategoryKey;
  const title = String(form.get("title") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const exchangeHintRaw = String(form.get("exchange_hint") ?? "").trim();

  if (type !== "give" && type !== "get") {
    throw new HttpError(400, "Pick give or get.");
  }
  if (!CATEGORIES.some((c) => c.key === category)) {
    throw new HttpError(400, "Pick a valid category.");
  }
  if (title.length < 1 || title.length > 80) {
    throw new HttpError(400, "Title must be 1-80 characters.");
  }
  if (description.length < 1 || description.length > 1000) {
    throw new HttpError(400, "Description must be 1-1000 characters.");
  }
  if (exchangeHintRaw.length > 200) {
    throw new HttpError(400, "'In exchange' must be 200 characters or fewer.");
  }
  const exchangeHint = exchangeHintRaw.length > 0 ? exchangeHintRaw : null;

  const listingId = createListing(type, category, title, description, exchangeHint, user.nickname);

  // Save up to MAX_PHOTOS_PER_LISTING photos.
  const photos = form.getAll("photos").filter((p) => p instanceof File) as File[];
  const toSave = photos.filter((p) => p.size > 0).slice(0, MAX_PHOTOS_PER_LISTING);
  for (let i = 0; i < toSave.length; i++) {
    try {
      const name = await savePhoto(toSave[i]!);
      addPhotoToListing(listingId, name, i);
    } catch (e) {
      console.error("photo save failed:", e);
      // continue — partial photo failure shouldn't kill the listing
    }
  }

  return c.redirect(`/#l-${listingId}`);
});

// ---------- POST /l/:id/edit (creator-only field update) ----------

newListingRoutes.post("/l/:id/edit", async (c) => {
  const user = requireUser(c);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id < 1) throw new HttpError(404, "Listing not found.");
  const listing = getListingById(id);
  if (!listing) throw new HttpError(404, "Listing not found.");
  if (listing.creator_nickname !== user.nickname) {
    throw new HttpError(403, "Only the creator can edit this listing.");
  }
  if (listing.status !== "active" && listing.status !== "agreed") {
    throw new HttpError(400, "This listing can no longer be edited.");
  }

  const form = await c.req.formData();
  const title = String(form.get("title") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const exchangeHintRaw = String(form.get("exchange_hint") ?? "").trim();

  if (title.length < 1 || title.length > 80) {
    throw new HttpError(400, "Title must be 1-80 characters.");
  }
  if (description.length < 1 || description.length > 1000) {
    throw new HttpError(400, "Description must be 1-1000 characters.");
  }
  if (exchangeHintRaw.length > 200) {
    throw new HttpError(400, "'In exchange' must be 200 characters or fewer.");
  }
  const exchangeHint = exchangeHintRaw.length > 0 ? exchangeHintRaw : null;

  updateListingFields(id, title, description, exchangeHint);
  return c.redirect(`/#l-${id}`);
});

// Wraps content in the standard modal markup (.gg-modal#:id). Re-usable.
export function modalWrap(id: string, title: string, inner: string): string {
  const head = title
    ? `<header class="gg-modal__head">
        <h3 id="${esc(id)}-title">${esc(title)}</h3>
        <a class="gg-modal__close" href="#" aria-label="Close">×</a>
      </header>`
    : `<header class="gg-modal__head gg-modal__head--close-only">
        <a class="gg-modal__close" href="#" aria-label="Close">×</a>
      </header>`;
  const labelledBy = title ? ` aria-labelledby="${esc(id)}-title"` : "";
  return `<aside class="gg-modal" id="${esc(id)}"${labelledBy}>
      <a class="gg-modal__overlay" href="#" aria-label="Close" tabindex="-1"></a>
      <div class="gg-modal__panel" role="dialog" aria-modal="true">
        ${head}
        ${inner}
      </div>
    </aside>`;
}

// Build view + (if viewer is owner) edit modals for a set of listings.
// Caller provides creators + photos maps so we don't re-query when the page
// already has them. Pass empty maps to have us fetch them.
export function renderListingModals(
  listings: Listing[],
  viewer: User,
  opts: {
    creators?: Map<string, User>;
    photos?: Map<number, string[]>;
  } = {}
): string {
  const creators = opts.creators ?? new Map<string, User>();
  const photos = opts.photos ?? new Map<number, string[]>();

  return listings
    .map((l) => {
      const creator =
        creators.get(l.creator_nickname) ?? getUserByNickname(l.creator_nickname);
      if (!creator) return "";
      const photoList = photos.get(l.id) ?? getPhotosForListing(l.id);

      const isOwner = viewer.nickname === l.creator_nickname;
      const claims = isOwner ? getClaimsForListing(l.id) : [];
      const myClaim = isOwner
        ? null
        : getClaimByListingAndClaimant(l.id, viewer.nickname);

      const viewInner = renderListingDetail({
        listing: l,
        creator,
        photos: photoList,
        claims,
        viewer,
        myClaim,
        showBackLink: false,
      });

      let editModal = "";
      if (isOwner && (l.status === "active" || l.status === "agreed")) {
        editModal = modalWrap(`edit-l-${l.id}`, `Edit · ${l.title}`, editListingFormHtml(l));
      }

      return modalWrap(`l-${l.id}`, l.title, viewInner) + editModal;
    })
    .join("");
}

// ---------- Listing detail rendering ----------

// Renders the inner HTML for a listing detail view. Used by:
//   - the standalone /l/:id page (full-screen)
//   - the modal embed on browse (#l-:id)
// Caller is responsible for fetching `claims` only if the viewer is the creator.
export function renderListingDetail(opts: {
  listing: Listing;
  creator: User;
  photos: string[];
  claims: Claim[];           // empty array if viewer is not creator (saves a query)
  viewer: User;
  myClaim: Claim | null;     // viewer's claim on this listing, if any
  showBackLink: boolean;     // true on standalone page, false in modal
}): string {
  const { listing, creator, photos, claims, viewer, myClaim, showBackLink } = opts;
  const isCreator = viewer.nickname === listing.creator_nickname;

  const photosHtml =
    photos.length > 0
      ? html`<div class="photos">${raw(
          photos.map((p) => html`<img src="/photo/${p}" alt="">`).join("")
        )}</div>`
      : "";

  let claimBlock = "";
  if (listing.status === "completed") {
    claimBlock = html`<article><strong>This exchange is complete.</strong></article>`;
  } else if (listing.status === "deleted" || listing.status === "expired") {
    claimBlock = html`<article><em>This listing is no longer available.</em></article>`;
  } else if (isCreator) {
    if (claims.length === 0) {
      claimBlock = html`<article><em>No claims yet. Edit this listing from the card to refine it.</em></article>`;
    } else {
      const items = claims
        .map((cl) => {
          const claimant = getUserByNickname(cl.claimant_nickname)!;
          return html`
            <li>
              ${userSignal(claimant)}
              · <a href="/c/${cl.id}">open thread</a>
              · <small>${cl.status}</small>
            </li>
          `;
        })
        .join("");
      claimBlock = html`
        <article>
          <h4>Claims (${claims.length})</h4>
          <ul>${raw(items)}</ul>
        </article>
      `;
    }
  } else if (myClaim) {
    claimBlock = html`
      <article>
        You've claimed this. <a href="/c/${myClaim.id}">Open thread</a>.
      </article>
    `;
  } else {
    const buttonLabel = listing.type === "give" ? "I'll take it" : "I can help";
    claimBlock = html`
      <form method="post" action="/l/${listing.id}/claim" class="listing-detail__form">
        <textarea name="message" rows="2" maxlength="2000" required
          placeholder="Message ${listing.creator_nickname}…"
          aria-label="Message to ${listing.creator_nickname}"></textarea>
        <button type="submit">${buttonLabel}</button>
      </form>
    `;
  }

  // Non-creator: hint that others are interested (only counts if we have the data).
  const otherClaimsHint =
    !isCreator && claims.length > 0
      ? html`<p><small>${claims.length} ${claims.length === 1 ? "person has" : "people have"} already shown interest.</small></p>`
      : "";

  const categoryLabel = CATEGORIES.find((c) => c.key === listing.category)?.label ?? listing.category;
  const titleBlock = showBackLink
    ? html`<h2 class="listing-detail__title">${listing.title}</h2>`
    : "";

  return html`
    <div class="listing-detail listing-detail--${listing.type}${showBackLink ? " listing-detail--standalone" : ""}">
      ${titleBlock}

      <p class="listing-detail__meta">
        <span class="type-chip ${listing.type}">${listing.type}</span>
        <span>${categoryLabel}</span>
        <span class="listing-detail__dot">·</span>
        <span class="listing-detail__when">${relativeAge(listing.created_at)}</span>
      </p>

      <p class="listing-detail__author">${userSignal(creator)}</p>

      ${raw(photosHtml)}

      <hr class="listing-detail__rule">

      <p class="listing-detail__desc">${listing.description}</p>

      ${listing.exchange_hint
        ? html`<p class="listing-detail__exchange">${listing.exchange_hint}</p>`
        : ""}
      ${raw(otherClaimsHint)}
      ${isCreator && (listing.status === "active" || listing.status === "agreed")
        ? raw(html`<p class="listing-detail__edit"><a href="#edit-l-${listing.id}">Edit this listing</a></p>`)
        : ""}
      ${claimBlock ? raw(`<hr class="listing-detail__rule">${claimBlock}`) : ""}
      ${showBackLink ? html`<p class="listing-detail__back"><a href="/">← back to browse</a></p>` : ""}
    </div>
  `;
}

// ---------- GET /l/:id (standalone fallback) ----------

export const listingDetailRoute = new Hono();

listingDetailRoute.get("/l/:id", (c) => {
  const user = getCurrentUser(c);
  if (!user) {
    return c.html(layout({ title: "Join", user: null, body: signupCard(), theme: getTheme(c) }));
  }
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id < 1) {
    throw new HttpError(404, "Listing not found.");
  }

  const listing = getListingById(id);
  if (!listing) throw new HttpError(404, "Listing not found.");

  const creator = getUserByNickname(listing.creator_nickname);
  if (!creator) throw new HttpError(404, "Listing creator missing.");

  const photos = getPhotosForListing(id);
  const claims = getClaimsForListing(id);
  const myClaim = claims.find((cl) => cl.claimant_nickname === user.nickname) ?? null;

  const body = renderListingDetail({
    listing,
    creator,
    photos,
    claims,
    viewer: user,
    myClaim,
    showBackLink: true,
  });

  return c.html(layout({ title: listing.title, user, body, theme: getTheme(c) }));
});
