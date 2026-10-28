export const SETTING_KEYS = [
  'coin_name',
  'token_symbol',
  'token_mint',
  'rewards_wallet',
  'site_title',
  'tagline',
  'launch_note',
  'review_x_handle',
  'website_url',
  'x_url',
  'tiktok_url',
  'telegram_url',
  'dexscreener_url',
  'mascot_url',
  'theme_primary',
  'theme_secondary',
  'theme_accent',
  'snow',
  'min_holding',
  'reserve_sol',
  'next_billboard_target_usd',
];

export const DEFAULTS = {
  coin_name: 'Ansemmas',
  token_symbol: 'ANSEMMAS',
  token_mint: '',
  rewards_wallet: '',
  site_title: 'Merry Ansemmas',
  tagline: 'Merry Ansemmas. Creator rewards buy billboards. Holders pick where they go.',
  launch_note: 'Launching soon. Rewards tracking and holder voting go live at launch. You can submit billboard designs now.',
  review_x_handle: 'RiseofMemes',
  website_url: 'https://ansemmas.fun',
  x_url: 'https://x.com/Ansemmas',
  tiktok_url: 'https://www.tiktok.com/@ansemmas',
  telegram_url: '',
  dexscreener_url: '',
  mascot_url: '/mascot.webp',
  theme_primary: '#d0122d',
  theme_secondary: '#146b3a',
  theme_accent: '#f0c14a',
  snow: 'true',
  min_holding: '100000',
  reserve_sol: '0.05',
  next_billboard_target_usd: '50',
};

const ENV_MAP = {
  coin_name: 'COIN_NAME',
  token_symbol: 'TOKEN_SYMBOL',
  token_mint: 'TOKEN_MINT',
  rewards_wallet: 'REWARDS_WALLET',
  site_title: 'SITE_TITLE',
  tagline: 'TAGLINE',
  launch_note: 'LAUNCH_NOTE',
  review_x_handle: 'REVIEW_X_HANDLE',
  website_url: 'WEBSITE_URL',
  x_url: 'X_URL',
  tiktok_url: 'TIKTOK_URL',
  telegram_url: 'TELEGRAM_URL',
  dexscreener_url: 'DEXSCREENER_URL',
  mascot_url: 'MASCOT_URL',
  theme_primary: 'THEME_PRIMARY',
  theme_secondary: 'THEME_SECONDARY',
  theme_accent: 'THEME_ACCENT',
  snow: 'SNOW',
  min_holding: 'MIN_HOLDING',
  reserve_sol: 'RESERVE_SOL',
  next_billboard_target_usd: 'NEXT_BILLBOARD_TARGET_USD',
};

export function isDemo(env) {
  return env.DEMO === '1' || env.DEMO === 'true';
}

function truthy(value) {
  return value === true || value === 'true' || value === '1' || value === 'on';
}

export function readSettings(db, env = process.env) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const savedMap = {};
  for (const row of rows) savedMap[row.key] = row.value;
  const values = {};
  for (const key of SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(savedMap, key)) values[key] = savedMap[key];
    else if (env[ENV_MAP[key]] !== undefined && env[ENV_MAP[key]] !== '') values[key] = env[ENV_MAP[key]];
    else values[key] = DEFAULTS[key];
  }
  const tokenMint = String(values.token_mint || '').trim();
  const rewardsWallet = String(values.rewards_wallet || '').trim();
  return {
    values,
    saved: Object.keys(savedMap),
    tokenMint,
    rewardsWallet,
    launched: Boolean(tokenMint),
    snow: truthy(values.snow),
    minHolding: Number(values.min_holding),
    reserveSol: Number(values.reserve_sol),
    nextTargetUsd: Number(values.next_billboard_target_usd),
    demo: isDemo(env),
    maxUploadMb: Math.max(1, Number(env.MAX_UPLOAD_MB || 5)),
    adminEnabled: Boolean(env.ADMIN_TOKEN) || isDemo(env),
    publicUrl: String(env.PUBLIC_URL || '').replace(/\/$/, ''),
  };
}

export function publicConfig(settings) {
  const v = settings.values;
  return {
    demo: settings.demo,
    launched: settings.launched,
    coinName: v.coin_name || '',
    tokenSymbol: v.token_symbol || '',
    tokenMint: settings.tokenMint || null,
    rewardsWallet: settings.rewardsWallet || null,
    siteTitle: v.site_title,
    tagline: v.tagline,
    launchNote: v.launch_note,
    mascotUrl: v.mascot_url || null,
    links: {
      website: v.website_url || '',
      x: v.x_url || '',
      tiktok: v.tiktok_url || '',
      telegram: v.telegram_url || '',
      dexscreener: v.dexscreener_url || '',
    },
    reviewXHandle: v.review_x_handle || 'RiseofMemes',
    theme: {
      primary: v.theme_primary,
      secondary: v.theme_secondary,
      accent: v.theme_accent,
      snow: settings.snow,
    },
    minHolding: settings.minHolding,
    maxUploadMb: settings.maxUploadMb,
    adminEnabled: settings.adminEnabled,
    publicUrl: settings.publicUrl,
    message: {
      header: `${v.site_title} - holder signature`,
      footer: 'Signing this message is free. It does not send a transaction or give access to your funds.',
    },
  };
}

export function adminView(settings) {
  const v = { ...settings.values, snow: settings.snow, launched: settings.launched };
  return { values: v, saved: settings.saved };
}
