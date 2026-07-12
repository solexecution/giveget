import type { User, Listing, Claim, Message } from "./db";
import { CATEGORIES } from "./db";

// ---------- Escape + tagged template ----------

const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export function esc(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]!);
}

export type Raw = { __raw: string };
export function raw(s: string): Raw {
  return { __raw: s };
}
function isRaw(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && "__raw" in v;
}

/** Tag function: auto-escapes interpolations unless wrapped in raw(). Arrays are joined. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0]!;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isRaw(v)) {
      out += v.__raw;
    } else if (Array.isArray(v)) {
      out += v
        .map((x) => (isRaw(x) ? x.__raw : esc(x)))
        .join("");
    } else {
      out += esc(v);
    }
    out += strings[i + 1]!;
  }
  return out;
}

// ---------- Layout ----------

export type Theme = "light" | "dark" | undefined;

export function layout(opts: {
  title: string;
  user: User | null;
  body: string;
  flash?: string;
  welcomeName?: string;
  theme?: Theme;
  activeNav?: "browse" | "profile" | "coord" | "about";
  activeMenu?: "profile" | "archived";
  filterBlade?: { activeKey: string | null; list: string };
  coordNavVisible?: boolean;
}): string {
  const isCoord = opts.coordNavVisible ?? !!opts.user?.is_coordinator;
  const themeLabel = opts.theme === "light" ? "Switch to dark mode" : "Switch to light mode";
  const sunSvg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`;
  const moonSvg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>`;
  const themeIcon = opts.theme === "light" ? moonSvg : sunSvg;
  const personSvg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M12 14c-4.4 0-8 2.2-8 5v3h16v-3c0-2.8-3.6-5-8-5z"/></svg>`;
  const filterBtn = opts.filterBlade
    ? html`<details class="gg-menu cat-blade nav-desktop-only">
        <summary class="gg-icon-btn" aria-label="Filter by category">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M4 5h16v2l-6 7v5l-4 1v-6L4 7z"/></svg>
        </summary>
        <div class="gg-menu__panel cat-blade__panel">
          <h3>Category</h3>
          ${raw(opts.filterBlade.list)}
        </div>
      </details>`
    : "";

  const accountMenu = opts.user
    ? html`<details class="gg-menu">
        <summary class="gg-icon-btn" aria-label="Account menu for ${esc(opts.user.nickname)}">${raw(personSvg)}</summary>
        <div class="gg-menu__panel">
          <div class="gg-menu__head">
            <span>Signed in as <strong>${esc(opts.user.nickname)}</strong></span>
            <a class="gg-icon-btn" href="/toggle-theme" aria-label="${themeLabel}" title="${themeLabel}">${raw(themeIcon)}</a>
          </div>
          <a href="/me" class="gg-menu__item${opts.activeMenu === "profile" ? " is-active" : ""}">Your profile</a>
          <a href="/?hidden=1" class="gg-menu__item${opts.activeMenu === "archived" ? " is-active" : ""}">Hidden from browse</a>
          ${isCoord ? raw(`<a href="/coord" class="gg-menu__item">Coordinator panel</a>`) : ""}
          <form method="post" action="/logout">
            <button type="submit" class="gg-menu__btn">Sign out</button>
          </form>
        </div>
      </details>`
    : "";

  const headerUser = opts.user
    ? html`<a class="gg-header__user" href="/me" title="Your profile">${esc(opts.user.nickname)}</a>`
    : "";

  const headerActions = opts.user
    ? html`
        <div class="gg-header__actions">
          ${raw(headerUser)}
          <a class="gg-icon-btn gg-icon-btn--accent nav-desktop-only" href="/#new-listing" aria-label="New listing" title="New listing">+</a>
          ${filterBtn ? raw(filterBtn) : ""}
          ${accountMenu ? raw(accountMenu) : ""}
        </div>
      `
    : html`
        <div class="gg-header__actions">
          <a class="gg-icon-btn nav-desktop-only" href="/#about" aria-label="How it works">?</a>
          <a class="gg-icon-btn" href="/toggle-theme" aria-label="${themeLabel}" title="${themeLabel}">${raw(themeIcon)}</a>
        </div>
      `;

  const navBrowse = opts.activeNav === "browse" ? "is-active" : "";
  const navProfile = opts.activeNav === "profile" ? "is-active" : "";
  const navCoord = opts.activeNav === "coord" ? "is-active" : "";
  const bottomNavFourth = isCoord
    ? `<a href="/coord" class="${navCoord}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3l7 4v6c0 4-3 7-7 8-4-1-7-4-7-8V7z"/></svg>
        Coord
      </a>`
    : `<a href="/#about" class="${opts.activeNav === "about" ? "is-active" : ""}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7h.01"/></svg>
        About
      </a>`;
  const bottomNav = opts.user
    ? `<nav class="gg-bottom-nav" aria-label="Main">
        <a href="/" class="${navBrowse}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/></svg>
          Browse
        </a>
        <a href="/#new-listing">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          New
        </a>
        <a href="/me" class="${navProfile}" title="Profile &amp; archived listings">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M12 14c-4.4 0-8 2.2-8 5v3h16v-3c0-2.8-3.6-5-8-5z"/></svg>
          Profile
        </a>
        ${bottomNavFourth}
      </nav>
      ${opts.activeNav === "browse" ? `<a class="gg-bottom-nav__fab" href="/#new-listing" aria-label="New listing">+</a>` : ""}`
    : "";

  const flash = opts.flash
    ? html`<div class="gg-flash" role="status">${opts.flash}</div>`
    : "";

  const theme = opts.theme === "light" ? "light" : "dark";
  const themeAttr = ` data-theme="${theme}"`;
  const mainClass = opts.user ? "gg-main" : "gg-main gg-main--anon";
  return `<!doctype html>
<html lang="en"${themeAttr}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#10b981">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="GiveGet">
<meta name="description" content="Town Ranch barter board — give, get, and swap with neighbours.">
<title>${esc(opts.title)} — GiveGet</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/app.css?v=9">
</head>
<body>
<div class="gg-app">
  <header class="gg-header">
    <a class="gg-brand" href="/">
      <span class="gg-brand__mark">GG</span>
      GiveGet
    </a>
    ${headerActions}
  </header>
  <main class="${mainClass}">
    ${flash}
    ${opts.body}
  </main>
  ${bottomNav}
  ${aboutModalHtml()}
</div>
${opts.welcomeName ? `<div class="gg-toast" role="status">Welcome, <strong>${esc(opts.welcomeName)}</strong></div>` : ""}
<script>if("serviceWorker" in navigator){navigator.serviceWorker.register("/sw.js").catch(()=>{})}</script>
${opts.activeNav === "browse" ? '<script src="/card-swipe.js?v=3" defer></script>' : ""}
</body>
</html>`;
}

// ---------- Reusable view fragments ----------

export function signupCard(csrf: string): string {
  return html`
    <div class="gg-signup-wrap">
      <article class="gg-signup-card">
        <h2>Join Town Ranch</h2>
        <p>See what neighbours are giving and what they need. Pick a nickname — no email or phone required.</p>
        <form method="post" action="/signup" class="gg-form-stack">
          <input type="hidden" name="_csrf" value="${esc(csrf)}">
          <label class="gg-field">
            <span class="gg-field__label">Nickname</span>
            <input type="text" name="nickname" placeholder="your nickname"
              pattern="[A-Za-z0-9_]{3,30}" required autocomplete="username"
              maxlength="30" autofocus>
          </label>
          <button type="submit">Get started</button>
        </form>
        <small>3–30 characters · letters, numbers, underscore</small>
        <p class="gg-signup-card__alt"><a href="/login">Already have an account? Sign in</a> · <a href="/#about">How it works</a></p>
      </article>
    </div>
  `;
}

export function loginCard(prefillNick?: string, csrf?: string): string {
  const nick = prefillNick ? esc(prefillNick) : "";
  const csrfField = csrf ? html`<input type="hidden" name="_csrf" value="${esc(csrf)}">` : "";
  return html`
    <div class="gg-signup-wrap">
      <article class="gg-signup-card gg-signup-card--login">
        <h2>Sign in</h2>
        <p class="gg-signup-card__lead">Use your nickname and password to pick up where you left off.</p>
        <form method="post" action="/login" class="gg-form-stack">
          ${raw(csrfField)}
          <label class="gg-field">
            <span class="gg-field__label">Nickname</span>
            <input type="text" name="nickname" placeholder="your nickname"
              pattern="[A-Za-z0-9_]{3,30}" required autocomplete="username"
              maxlength="30" value="${nick}" autofocus>
          </label>
          <label class="gg-field">
            <span class="gg-field__label">Password</span>
            <input type="password" name="password" placeholder="your password"
              minlength="6" maxlength="200" required autocomplete="current-password">
          </label>
          <label class="gg-check">
            <input type="checkbox" name="remember" value="1" checked>
            <span>Remember me on this device</span>
          </label>
          <button type="submit">Sign in</button>
        </form>
        <p class="gg-signup-card__alt"><a href="/">New here? Join Town Ranch</a></p>
      </article>
    </div>
  `;
}

export function loggedInCard(user: User): string {
  return html`
    <div class="gg-signup-wrap">
      <article class="gg-signup-card gg-signup-card--session">
        <h2>Already signed in</h2>
        <p class="gg-session-card__who">Signed in as <strong>${esc(user.nickname)}</strong></p>
        <p class="gg-signup-card__lead">You can jump back to the board or sign out to use a different account.</p>
        <div class="gg-session-card__actions">
          <a class="gg-btn-primary" href="/">Continue to board</a>
          <form method="post" action="/logout">
            <button type="submit" class="gg-btn-ghost">Sign out</button>
          </form>
        </div>
      </article>
    </div>
  `;
}

export function aboutContentHtml(): string {
  return html`
    <div class="gg-about">
      <p>
        GiveGet is a barter platform for Town Ranch. You post things you want to <strong>give</strong>
        (something you have, a service you can do) or things you want to <strong>get</strong>
        (something you need). The exchange happens between neighbours, in person, without money
        passing through this page.
      </p>
      <h4>The give/get tally</h4>
      <p>
        Every time you give something, your <strong>Given</strong> count goes up by one.
        Every time you receive, your <strong>Received</strong> count goes up by one. Both
        counts are visible on your profile and on every listing you create.
      </p>
      <p>
        There are no points, no money, no spendable tokens — just a count of times you
        showed up for the community.
      </p>
      <h4>Trust</h4>
      <p>
        New members are <em>unvouched</em>. A Town Ranch coordinator vouches you after meeting
        you. Vouching is the trust signal.
      </p>
      <h4>What you don't need</h4>
      <p>
        No Google account. No WhatsApp. No phone number unless you choose to add one.
        No email unless you choose to add one. No real name. Just a nickname.
      </p>
    </div>
  `;
}

export function aboutModalHtml(): string {
  return html`
    <aside class="gg-modal" id="about" aria-labelledby="about-title">
      <a class="gg-modal__overlay" href="#" aria-label="Close" tabindex="-1"></a>
      <div class="gg-modal__panel" role="dialog" aria-modal="true">
        <header class="gg-modal__head">
          <h3 id="about-title">How GiveGet works</h3>
          <a class="gg-modal__close" href="#" aria-label="Close">×</a>
        </header>
        ${raw(aboutContentHtml())}
      </div>
    </aside>
  `;
}

export function userSignal(u: User): Raw {
  const badge = u.is_vouched ? "vouched" : "new";
  const ageLabel = u.is_vouched ? "✓ vouched" : "new";
  return raw(html`<span class="signal">
    <a href="/u/${u.nickname}"><strong>${u.nickname}</strong></a>
    <span class="badge ${badge}">${ageLabel}</span>
    · Given ${u.given_count} · Received ${u.received_count}
  </span>`);
}

export function categoryFilterList(activeKey: string | null, type: "give" | "get"): Raw {
  const allHref = type === "give" ? "/" : "/?need";
  const items = [
    `<a href="${allHref}" class="gg-cat-list__item${activeKey === null ? " is-active" : ""}">All categories</a>`,
    ...CATEGORIES.map((c) => {
      const href = type === "give" ? `/?cat=${c.key}` : `/?need&cat=${c.key}`;
      const cls = activeKey === c.key ? " is-active" : "";
      return `<a href="${href}" class="gg-cat-list__item${cls}">${esc(c.label)}</a>`;
    }),
  ].join("");
  return raw(`<nav class="gg-cat-list" aria-label="Filter by category">${items}</nav>`);
}

export function listingCard(
  l: Listing,
  creator: User,
  photoPaths: string[],
  opts: {
    hrefPrefix?: string;
    viewer?: User | null;
    isNew?: boolean;
    swipeArchive?: boolean;
    restoreAction?: boolean;
  } = {}
): Raw {
  const cat = CATEGORIES.find((c) => c.key === l.category)?.label ?? l.category;
  const age = relativeAge(l.created_at);
  const firstPhoto = photoPaths[0];
  // On browse the prefix is "#l-" so card click opens the modal; elsewhere it's "/l/" (full page).
  const prefix = opts.hrefPrefix ?? "/l/";
  const isOwner = !!opts.viewer && opts.viewer.nickname === l.creator_nickname;
  const editLink =
    isOwner && (l.status === "active" || l.status === "agreed")
      ? raw(`<a href="#edit-l-${l.id}" class="listing-card__edit" aria-label="Edit listing">edit</a>`)
      : "";
  const newClass = opts.isNew ? " listing-card--new" : "";
  const newBadge = opts.isNew
    ? raw(`<span class="listing-card__new-badge">New</span>`)
    : "";
  const cardInner = html`
    <article class="listing-card listing-card--${l.type}${newClass}">
      <h4><a href="${prefix}${l.id}">${l.title}</a>${editLink}${newBadge}</h4>
      <p class="listing-card__meta">
        <span class="type-chip ${l.type}">${l.type}</span>
        <span>${cat}</span>
        <span class="listing-card__dot">·</span>
        <span>${age}</span>
      </p>
      <p class="listing-card__author">${userSignal(creator)}</p>
      ${firstPhoto ? raw(`<div class="photos small"><img src="/photo/${esc(firstPhoto)}" alt=""></div>`) : ""}
    </article>
  `;

  if (opts.restoreAction) {
    return raw(html`
      <div class="listing-restore" data-listing-id="${l.id}" data-listing-type="${l.type}">
        ${raw(cardInner)}
        <form method="post" action="/l/${l.id}/unarchive" class="listing-restore__form">
          <button type="submit" class="listing-restore__btn">Restore</button>
        </form>
      </div>
    `);
  }

  if (!opts.swipeArchive) return raw(cardInner);

  return raw(html`
    <div class="listing-swipe" data-listing-id="${l.id}" data-listing-type="${l.type}">
      <div class="listing-swipe__action" aria-hidden="true">
        <span class="listing-swipe__label">Hide</span>
      </div>
      <div class="listing-swipe__panel">
        ${raw(cardInner)}
        <form method="post" action="/l/${l.id}/archive" class="listing-swipe__archive-form">
          <button type="submit" class="listing-card__archive-btn" aria-label="Hide listing from feed">Hide from feed</button>
        </form>
      </div>
    </div>
  `);
}

export function messageBubble(m: Message, currentUser: string): Raw {
  const mine = m.sender_nickname === currentUser;
  const cls = mine ? "mine" : "theirs";
  return raw(html`
    <div class="thread-msg ${cls}">
      <div class="who">${m.sender_nickname} · ${relativeAge(m.created_at)}</div>
      <div>${m.content}</div>
    </div>
  `);
}

// ---------- Helpers ----------

export function relativeAge(epochSecs: number): string {
  const diff = Math.floor(Date.now() / 1000) - epochSecs;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mo ago`;
  return `${Math.floor(days / 365)} y ago`;
}

export function errorPage(opts: {
  user: User | null;
  status: number;
  message: string;
  hint?: Raw;
  theme?: Theme;
}): string {
  return layout({
    title: `${opts.status}`,
    user: opts.user,
    theme: opts.theme,
    body: html`
      <article class="gg-article gg-error">
        <h2>${opts.status}</h2>
        <p>${opts.message}</p>
        ${opts.hint ?? ""}
        <p><a href="/">← back to browse</a></p>
      </article>
    `,
  });
}
