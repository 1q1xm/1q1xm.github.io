import { revealFocusLine, titleToSignaturePause } from "./title-focus.mjs";

const titles = document.querySelector(".black-cover-titles");
const ink = document.querySelector(".signature-ink");
titles.dataset.pending = "";

async function reveal() {
  await Promise.allSettled([
    ...document.querySelector("#about-opening").getAnimations().map(a => a.finished),
    document.fonts.load('660 1em "Cover Mona"'),
    document.fonts.load('700 1em "Cover Brier"'),
  ]);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  delete titles.dataset.pending;
  if (!reduced) {
    await Promise.allSettled(Array.from(titles.children, (line, i) => revealFocusLine(line, i).finished));
    await new Promise(resolve => setTimeout(resolve, titleToSignaturePause));
  }
  titles.classList.add("under-ink");
  ink.src = ink.dataset.src + (reduced ? "#still" : "");
}
const root = document.documentElement;
const observer = new MutationObserver(start);
function start() {
  if (root.classList.contains("about-starting")) return;
  observer.disconnect();
  reveal();
}
observer.observe(root, { attributes: true, attributeFilter: ["class"] });
start();
