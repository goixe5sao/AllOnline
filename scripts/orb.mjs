/** Test helpers for the alien orb menu in the room (every function lives inside it). */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Open the orb if needed and click one of its functions (data-orb id: chat, hand, qa, screen, view, sound, control, seats, settings, leave). */
export async function orb(p, id) {
  const open = await p.evaluate(() => document.querySelector(".orb-root")?.classList.contains("open"));
  if (!open) {
    // DOM click: a real mouse click waits for a frame, and a software-rendered 3D frame can take a minute
    await p.evaluate(() => document.querySelector(".orb")?.click());
    await sleep(450);
  }
  await p.evaluate((id) => document.querySelector(`[data-orb="${id}"]`)?.click(), id);
  await sleep(300);
}

/** Send a reaction through the orb (😊 → emoji). */
export async function react(p, emoji) {
  const open = await p.evaluate(() => document.querySelector(".orb-root")?.classList.contains("open"));
  if (!open) {
    // DOM click: a real mouse click waits for a frame, and a software-rendered 3D frame can take a minute
    await p.evaluate(() => document.querySelector(".orb")?.click());
    await sleep(450);
  }
  if (!(await p.$(`button[aria-label="Thả ${emoji}"]`))) {
    await p.evaluate(() => document.querySelector('[data-orb="react"]')?.click());
    await sleep(350);
  }
  await p.evaluate((e) => document.querySelector(`button[aria-label="Thả ${e}"]`)?.click(), emoji);
  await sleep(120);
}

/** Label of an orb function (e.g. "Góc của tôi"), or null when not shown. */
export const orbLabel = (p, id) => p.evaluate((id) => document.querySelector(`[data-orb="${id}"]`)?.getAttribute("aria-label") ?? null, id);

export async function closeOrb(p) {
  await p.keyboard.press("Escape");
  await sleep(300);
}
