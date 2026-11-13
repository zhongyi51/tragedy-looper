const ENTITIES={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
export const esc=x=>String(x??'').replace(/[&<>"']/g,c=>ENTITIES[c]);

// 24×24 stroke icons. Kept inline because the page's CSP only allows same-origin resources.
const PATHS={
 heart:'<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.4A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
 unrest:'<path d="M12 3 2.5 20h19L12 3z"/><path d="M12 10v4.5M12 17.3v.2"/>',
 intrigue:'<path d="M12 2.5 20 12l-8 9.5L4 12l8-9.5z"/><path d="M12 8.5 15 12l-3 3.5L9 12l3-3.5z"/>',
 shield:'<path d="M12 3 5 6v5c0 4.6 3 8.4 7 10 4-1.6 7-5.4 7-10V6l-7-3z"/>',
 moveH:'<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
 moveV:'<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>',
 moveD:'<path d="M5 19 19 5M5 13v6h6M13 5h6v6"/>',
 ban:'<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
 loop:'<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>',
 soundOn:'<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
 soundOff:'<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 16.8v.2"/>',
 download:'<path d="M12 4v11M7.5 11 12 15.5 16.5 11M5 19.5h14"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 close:'<path d="m6 6 12 12M18 6 6 18"/>',
 play:'<path d="M8 5.5v13l10.5-6.5L8 5.5z"/>',
 pause:'<path d="M8 5.5v13M16 5.5v13"/>',
 prev:'<path d="m14.5 6-6 6 6 6"/>',
 next:'<path d="m9.5 6 6 6-6 6"/>',
 sync:'<path d="M20 11a8 8 0 0 0-14.5-3.5M4 4v4h4M4 13a8 8 0 0 0 14.5 3.5M20 20v-4h-4"/>',
 panel:'<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M14.5 4.5v15"/>',
 skull:'<path d="M12 3.5a7 7 0 0 0-4.5 12.4V19h9v-3.1A7 7 0 0 0 12 3.5z"/><path d="M9.3 11.5v.2M14.7 11.5v.2M10.5 19v-2M13.5 19v-2"/>',
 crown:'<path d="M4 8.5 7.5 12 12 6l4.5 6L20 8.5 18.5 18h-13L4 8.5z"/>',
 alert:'<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.3v.2"/>',
 eye:'<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
 mask:'<path d="M3.5 7.5c3-1.5 5.5-1.5 8.5 0 3-1.5 5.5-1.5 8.5 0 0 6-3 9.5-5.5 9.5-1.4 0-2.2-1-3-2-.8 1-1.6 2-3 2C6.5 17 3.5 13.5 3.5 7.5z"/><path d="M7 11h2.5M14.5 11H17"/>',
 users:'<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.4-3.2 2.6-5 5.5-5s5.1 1.8 5.5 5"/><path d="M15 5.8a3 3 0 0 1 0 5.4M17 14.3c1.9.6 3.2 2.2 3.5 4.7"/>',
 bot:'<rect x="5" y="8.5" width="14" height="10" rx="2.5"/><path d="M12 5v3.5M9.5 13v.2M14.5 13v.2M2.5 12.5v3M21.5 12.5v3"/><circle cx="12" cy="4" r="1"/>',
 book:'<path d="M5 4.5h10a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3v-12z"/><path d="M5 16.5a3 3 0 0 1 3-3h10"/>',
 pen:'<path d="m4.5 19.5 1-4.5L16 4.5l3.5 3.5L9 18.5l-4.5 1z"/>',
 film:'<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M8 5v14M16 5v14M3.5 12h17"/>',
 home:'<path d="m4 11 8-7 8 7v9h-5.5v-5.5h-5V20H4v-9z"/>',
 board:'<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M12 3.5v17M3.5 12h17"/>',
 hand:'<rect x="4" y="6" width="9" height="13" rx="1.5" transform="rotate(-8 8.5 12.5)"/><rect x="11" y="5" width="9" height="13" rx="1.5" transform="rotate(8 15.5 11.5)"/>',
 check:'<path d="m5 12.5 4.5 4.5L19 7.5"/>',
 clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
 flag:'<path d="M6 21V4M6 5h11l-2 3.5 2 3.5H6"/>',
 sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'
};
export const icon=(name,cls='')=>`<svg class="ic${cls?' '+cls:''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PATHS[name]||''}</svg>`;

export const btn=(text,action,cls='',extra='')=>`<button type="button" class="btn${cls?' '+cls:''}" data-do="${action}"${extra?' '+extra:''}>${text}</button>`;
export const iconBtn=(name,action,label,cls='',extra='')=>`<button type="button" class="icon-btn${cls?' '+cls:''}" data-do="${action}" title="${esc(label)}" aria-label="${esc(label)}"${extra?' '+extra:''}>${icon(name)}</button>`;
