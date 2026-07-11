import { Hono } from "hono";
import {
  CATEGORIES,
  type CategoryKey,
  type Claim,
  type Listing,
  type ListingType,
  type User,
  archiveListing,
  createListing,
  filterArchivedListings,
  getActiveListings,
  getArchivedListingIds,
  getClaimByListingAndClaimant,
  getClaimsForListing,
  getListingById,
  getPhotosForListing,
  getUserByNickname,
  addPhotoToListing,
  countListingsLast24h,
  isListingNewSinceLastVisit,
  markBoardSeen,
  RATE_LIMITS,
  getUserArchivedActiveListings,
  updateListingFields,
  unarchiveListing,
} from "../db";
import { getCoordNavVisible } from "../device-auth";
import { getCurrentUser, getTheme, HttpError, requireUser, ensureCsrfToken } from "../session";
import {
  categoryFilterList,
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

function wantsJson(c: { req: { header: (name: string) => string | undefined } }): boolean {
  const accept = c.req.header("accept") ?? "";
  return accept.includes("application/json");
}

// ---------- GET / (browse) ----------

export const browseRoute = new Hono();

browseRoute.get("/", (c) => {
  const user = getCurrentUser(c);
  const url = new URL(c.req.url);

  // Gate: signed-out visitors get only the signup card. No listings until they join.
  if (!user) {
    const csrf = ensureCsrfToken(c);
    return c.html(layout({ title: "Join", user: null, body: signupCard(csrf), theme: getTheme(c) }));
  }

  const cat = url.searchParams.get("cat") as CategoryKey | null;
  const validCat = cat && CATEGORIES.some((x) => x.key === cat) ? cat : null;
  const showHidden = url.searchParams.get("hidden") === "1";

  const lastBoardSeenAt = user.last_board_seen_at;
  const archivedIds = new Set(getArchivedListingIds(user.nickname));

  const boardGives = filterArchivedListings(getActiveListings("give", validCat ?? undefined), archivedIds);
  const boardGets = filterArchivedListings(getActiveListings("get", validCat ?? undefined), archivedIds);
  const hiddenGives = getUserArchivedActiveListings(user.nickname, "give", validCat ?? undefined);
  const hiddenGets = getUserArchivedActiveListings(user.nickname, "get", validCat ?? undefined);
  const hiddenCount = hiddenGives.length + hiddenGets.length;

  type FeedItem = Listing;
  const allListings = [...boardGives, ...boardGets, ...hiddenGives, ...hiddenGets];

  const creators = new Map<string, User>();
  const photosByListing = new Map<number, string[]>();
  for (const l of allListings) {
    const creator = creators.get(l.creator_nickname) ?? getUserByNickname(l.creator_nickname);
    if (creator) creators.set(creator.nickname, creator);
    photosByListing.set(l.id, getPhotosForListing(l.id));
  }

  const renderCol = (
    items: FeedItem[],
    emptyLabel: string,
    cardOpts: { swipeArchive?: boolean; restoreAction?: boolean; isNew?: boolean }
  ) =>
    items.length === 0
      ? html`<p><em>${emptyLabel}</em></p>`
      : items
          .map((l) => {
            const creator = creators.get(l.creator_nickname);
            if (!creator) return "";
            const swipeArchive =
              cardOpts.swipeArchive && l.creator_nickname !== user.nickname;
            return listingCard(l, creator, photosByListing.get(l.id) ?? [], {
              hrefPrefix: "#l-",
              viewer: user,
              isNew: cardOpts.isNew ? isListingNewSinceLastVisit(l.created_at, lastBoardSeenAt) : false,
              swipeArchive,
              restoreAction: cardOpts.restoreAction,
            }).__raw;
          })
          .join("");

  const feedTabsHtml = (
    prefix: string,
    givesCol: string,
    getsCol: string,
    giveEmpty: string,
    getEmpty: string
  ) => {
    const giveId = `tab-${prefix}-give`;
    const getId = `tab-${prefix}-get`;
    return html`
    <div class="feed-tabs feed-tabs--${prefix}">
      <input type="radio" name="feed-tab-${prefix}" id="${giveId}" class="feed-tabs__radios" checked>
      <input type="radio" name="feed-tab-${prefix}" id="${getId}" class="feed-tabs__radios">
      <nav class="feed-tabs__nav" aria-label="Give or Get">
        <label for="${giveId}">Give</label>
        <label for="${getId}">Get</label>
      </nav>
      <div class="feed-cols">
        <section class="feed-cols__give">
          <h3>Give — things people share</h3>
          ${raw(givesCol || html`<p><em>${giveEmpty}</em></p>`)}
        </section>
        <section class="feed-cols__get">
          <h3>Get — things people need</h3>
          ${raw(getsCol || html`<p><em>${getEmpty}</em></p>`)}
        </section>
      </div>
    </div>
  `;
  };

  const boardGivesCol = renderCol(boardGives, "Nothing on offer yet. Be the first.", {
    swipeArchive: true,
    isNew: true,
  });
  const boardGetsCol = renderCol(boardGets, "Nobody's asked for anything yet.", {
    swipeArchive: true,
    isNew: true,
  });
  const hiddenGivesCol = renderCol(hiddenGives, "Nothing hidden in Give.", { restoreAction: true });
  const hiddenGetsCol = renderCol(hiddenGets, "Nothing hidden in Get.", { restoreAction: true });

  const detailModals = renderListingModals(allListings, user, {
    creators,
    photos: photosByListing,
  });

  const scopeBoardChecked = showHidden ? "" : " checked";
  const scopeHiddenChecked = showHidden ? " checked" : "";
  const hiddenBadge = hiddenCount > 0 ? ` (${hiddenCount})` : "";

  const body = html`
    <h2 class="gg-page-title">Town Ranch board</h2>
    <p class="gg-page-sub">Give what you have · Get what you need</p>
    <div class="board-scope">
      <input type="radio" name="board-scope" id="scope-board" class="board-scope__radios"${raw(scopeBoardChecked)}>
      <input type="radio" name="board-scope" id="scope-hidden" class="board-scope__radios"${raw(scopeHiddenChecked)}>
      <nav class="board-scope__nav" aria-label="Board or Hidden">
        <label for="scope-board">Board</label>
        <label for="scope-hidden">Hidden${raw(hiddenBadge)}</label>
      </nav>
      <div class="board-scope__panel board-scope__panel--board">
        ${raw(feedTabsHtml(
          "board",
          boardGivesCol,
          boardGetsCol,
          "Nothing on offer yet. Be the first.",
          "Nobody's asked for anything yet."
        ))}
      </div>
      <div class="board-scope__panel board-scope__panel--hidden">
        <p class="board-scope__hint"><em>Swipe left on Board to hide listings you're not interested in.</em></p>
        ${raw(feedTabsHtml(
          "hidden",
          hiddenGivesCol,
          hiddenGetsCol,
          "Nothing hidden in Give.",
          "Nothing hidden in Get."
        ))}
      </div>
    </div>

    ${raw(modalWrap("new-listing", "New listing", newListingFormHtml("give")))}
    ${raw(detailModals)}
  `;

  const welcomeName = url.searchParams.has("welcome") ? user.nickname : undefined;
  markBoardSeen(user.nickname);
  return c.html(layout({
    title: "Browse",
    user,
    body,
    welcomeName,
    theme: getTheme(c),
    activeNav: "browse",
    filterBlade: { activeKey: validCat, list: categoryFilterList(validCat, "give").__raw },
    coordNavVisible: getCoordNavVisible(c, user),
  }));
});

// ---------- GET/POST /new (create listing) ----------

export const newListingRoutes = new Hono();

export function editListingFormHtml(listing: Listing): string {
  return html`
    <form method="post" action="/l/${listing.id}/edit" class="gg-form-stack">
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

function listingTypeSegment(defaultType: ListingType): string {
  const giveChecked = defaultType === "give" ? " checked" : "";
  const getChecked = defaultType === "get" ? " checked" : "";
  return `
    <fieldset class="gg-type-segment">
      <legend class="gg-sr-only">Listing type</legend>
      <div class="gg-segment gg-segment--pill" role="radiogroup" aria-label="Give or Get">
        <input type="radio" name="type" value="give" id="type_give" class="gg-segment__radio"${giveChecked}>
        <label for="type_give" class="gg-segment__label gg-segment__label--give">Give</label>
        <input type="radio" name="type" value="get" id="type_get" class="gg-segment__radio"${getChecked}>
        <label for="type_get" class="gg-segment__label gg-segment__label--get">Get</label>
      </div>
    </fieldset>
  `;
}

function categorySegment(defaultKey: CategoryKey = "tools"): string {
  const pickedLabels = CATEGORIES.map(
    (cat) => `<span class="gg-dropdown__picked gg-dropdown__picked--${cat.key}">${esc(cat.label)}</span>`
  ).join("");
  const options = CATEGORIES.map((cat, i) => {
    const id = `cat_${cat.key}`;
    const checked = cat.key === defaultKey ? " checked" : "";
    const required = i === 0 ? " required" : "";
    return `
      <label class="gg-dropdown__option" for="${id}">
        <input type="radio" name="category" value="${cat.key}" id="${id}" class="gg-dropdown__radio"${checked}${required}>
        <span>${esc(cat.label)}</span>
      </label>`;
  }).join("");

  return `
    <div class="gg-field gg-category-dropdown">
      <span class="gg-field__label" id="listing_category_label">Category</span>
      <details class="gg-dropdown">
        <summary class="gg-dropdown__trigger" aria-labelledby="listing_category_label">
          <span class="gg-dropdown__value">${pickedLabels}</span>
          <span class="gg-dropdown__chevron" aria-hidden="true"></span>
        </summary>
        <div class="gg-dropdown__panel" role="radiogroup" aria-label="Category">
          ${options}
        </div>
      </details>
    </div>`;
}

export function newListingFormHtml(defaultType: ListingType = "give"): string {
  return html`
    <form method="post" action="/new" enctype="multipart/form-data" class="gg-form-stack gg-form-stack--listing">
      ${raw(listingTypeSegment(defaultType))}
      ${raw(categorySegment())}

      <div class="gg-field">
        <label class="gg-field__label" for="listing_title">Title</label>
        <input class="gg-field__input" type="text" id="listing_title" name="title" maxlength="80" required
          placeholder="e.g. Drill, can lend">
      </div>

      <div class="gg-field">
        <label class="gg-field__label" for="listing_description">Description</label>
        <textarea class="gg-field__input" id="listing_description" name="description" maxlength="1000" rows="3" required
          placeholder="When it's available, condition, where to find you…"></textarea>
      </div>

      <div class="gg-field">
        <label class="gg-field__label" for="exchange_hint">In exchange</label>
        <p class="gg-field__hint">What would make this feel fair? Specific asks get more replies.</p>
        <input class="gg-field__input" type="text" id="exchange_hint" name="exchange_hint" maxlength="200"
          placeholder="e.g. fresh eggs · garden help · a thank-you note">
      </div>

      <div class="gg-field">
        <span class="gg-field__label" id="listing_photos_label">Photos</span>
        <p class="gg-field__hint">Up to ${MAX_PHOTOS_PER_LISTING} images</p>
        <label class="gg-file-drop" aria-labelledby="listing_photos_label">
          <input class="gg-file-drop__input" type="file" name="photos" accept="image/*" multiple>
          <span class="gg-file-drop__body">
            <span class="gg-file-drop__icon" aria-hidden="true">+</span>
            <span class="gg-file-drop__text">Tap to add photos</span>
          </span>
        </label>
      </div>

      <button type="submit" class="gg-btn-post">Post listing</button>
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

  return c.html(layout({ title: "New listing", user, body, theme: getTheme(c), coordNavVisible: getCoordNavVisible(c, user) }));
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

// ---------- POST /l/:id/archive (hide from browse) ----------

newListingRoutes.post("/l/:id/archive", (c) => {
  const user = requireUser(c);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id < 1) throw new HttpError(404, "Listing not found.");
  const listing = getListingById(id);
  if (!listing) throw new HttpError(404, "Listing not found.");
  if (listing.creator_nickname === user.nickname) {
    throw new HttpError(400, "You can't archive your own listing.");
  }
  if (listing.status !== "active") {
    throw new HttpError(400, "Only active listings can be archived.");
  }
  archiveListing(user.nickname, id);
  if (wantsJson(c)) return c.json({ ok: true, id });
  return c.redirect("/");
});

// ---------- POST /l/:id/unarchive (restore to browse) ----------

newListingRoutes.post("/l/:id/unarchive", (c) => {
  const user = requireUser(c);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id < 1) throw new HttpError(404, "Listing not found.");
  unarchiveListing(user.nickname, id);
  if (wantsJson(c)) return c.json({ ok: true, id });
  const back = c.req.header("referer") ?? "/?hidden=1";
  return c.redirect(back);
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
    ? raw(html`<h2 class="listing-detail__title">${listing.title}</h2>`)
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
        ? raw(html`<p class="listing-detail__exchange">${listing.exchange_hint}</p>`)
        : ""}
      ${raw(otherClaimsHint)}
      ${isCreator && (listing.status === "active" || listing.status === "agreed")
        ? raw(html`<p class="listing-detail__edit"><a href="#edit-l-${listing.id}">Edit this listing</a></p>`)
        : ""}
      ${claimBlock ? raw(`<hr class="listing-detail__rule">${claimBlock}`) : ""}
      ${showBackLink ? raw(html`<p class="listing-detail__back"><a href="/">← back to browse</a></p>`) : ""}
    </div>
  `;
}

// ---------- GET /l/:id (standalone fallback) ----------

export const listingDetailRoute = new Hono();

listingDetailRoute.get("/l/:id", (c) => {
  const user = getCurrentUser(c);
  if (!user) {
    const csrf = ensureCsrfToken(c);
    return c.html(layout({ title: "Join", user: null, body: signupCard(csrf), theme: getTheme(c) }));
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

  return c.html(layout({ title: listing.title, user, body, theme: getTheme(c), coordNavVisible: getCoordNavVisible(c, user) }));
});
