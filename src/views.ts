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
  filterBlade?: { activeKey: string | null; chips: string };
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
          <h3>Categories</h3>
          ${raw(opts.filterBlade.chips)}
        </div>
      </details>`
    : "";

  const accountMenu = opts.user
    ? html`<details class="gg-menu">
        <summary class="gg-icon-btn" aria-label="Account menu">${raw(personSvg)}</summary>
        <div class="gg-menu__panel">
          <div class="gg-menu__head">
            <span>Signed in as <strong>${esc(opts.user.nickname)}</strong></span>
            <a class="gg-icon-btn" href="/toggle-theme" aria-label="${themeLabel}" title="${themeLabel}">${raw(themeIcon)}</a>
          </div>
          <a href="/me" class="gg-menu__item">Your profile</a>
          ${isCoord ? raw(`<a href="/coord" class="gg-menu__item">Coordinator panel</a>`) : ""}
          <form method="post" action="/logout">
            <button type="submit" class="gg-menu__btn">Sign out</button>
          </form>
        </div>
      </details>`
    : "";

  const headerActions = opts.user
    ? html`
        <div class="gg-header__actions">
          <a class="gg-icon-btn gg-icon-btn--accent nav-desktop-only" href="/#new-listing" aria-label="New listing" title="New listing">+</a>
          ${filterBtn ? raw(filterBtn) : ""}
          ${accountMenu ? raw(accountMenu) : ""}
        </div>
      `
    : html`
        <div class="gg-header__actions">
          <a class="gg-icon-btn nav-desktop-only" href="/about" aria-label="How it works">?</a>
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
    : `<a href="/about" class="${opts.activeNav === "about" ? "is-active" : ""}">
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
        <a href="/me" class="${navProfile}">
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

  const themeAttr = opts.theme === "light" || opts.theme === "dark" ? ` data-theme="${opts.theme}"` : "";
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
<link rel="stylesheet" href="/app.css">
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
</div>
${opts.welcomeName ? `<div class="gg-toast" role="status">Welcome, <strong>${esc(opts.welcomeName)}</strong></div>` : ""}
<script>if("serviceWorker" in navigator){navigator.serviceWorker.register("/sw.js").catch(()=>{})}</script>
</body>
</html>`;
}

// ---------- Reusable view fragments ----------

export function signupCard(): string {
  return html`
    <div class="gg-signup-wrap">
      <article class="gg-signup-card">
        <h2>Join Town Ranch</h2>
        <p>See what neighbours are giving and what they need. Pick a nickname — no email or phone required.</p>
        <form method="post" action="/signup">
          <input type="text" name="nickname" placeholder="your nickname"
            pattern="[A-Za-z0-9_]{3,30}" required autocomplete="username"
            maxlength="30" autofocus>
          <button type="submit">Get started</button>
        </form>
        <small>3–30 characters · letters, numbers, underscore</small>
      </article>
    </div>
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

export function categoryChips(activeKey: string | null, type: "give" | "get"): Raw {
  const allHref = type === "give" ? "/" : "/?need";
  const chips = CATEGORIES.map((c) => {
    const href = type === "give" ? `/?cat=${c.key}` : `/?need&cat=${c.key}`;
    const cls = activeKey === c.key ? "active" : "";
    return html`<a href="${href}" class="${cls}">${c.label}</a>`;
  }).join("");
  const allCls = activeKey === null ? "active" : "";
  return raw(`<div class="category-chips"><a href="${allHref}" class="${allCls}">All</a>${chips}</div>`);
}

export function listingCard(
  l: Listing,
  creator: User,
  photoPaths: string[],
  opts: { hrefPrefix?: string; viewer?: User | null } = {}
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
  return raw(html`
    <article class="listing-card listing-card--${l.type}">
      <h4><a href="${prefix}${l.id}">${l.title}</a>${editLink}</h4>
      <p class="listing-card__meta">
        <span class="type-chip ${l.type}">${l.type}</span>
        <span>${cat}</span>
        <span class="listing-card__dot">·</span>
        <span>${age}</span>
      </p>
      <p class="listing-card__author">${userSignal(creator)}</p>
      ${firstPhoto ? raw(`<div class="photos small"><img src="/photo/${esc(firstPhoto)}" alt=""></div>`) : ""}
    </article>
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
