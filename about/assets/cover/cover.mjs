import { titleToSignaturePause } from "./title-focus.mjs";

const titles = document.querySelector(".sky-type");
const ink = document.querySelector(".signature-ink");
const opening = document.querySelector("#about-opening");
const root = document.documentElement;

async function revealCover() {
  // Wait for the original loading screen to finish fading and the title font to settle.
  await Promise.allSettled([
    ...opening.getAnimations().map(animation => animation.finished),
    document.fonts.load('900 1em "Cover Mona"'),

  ]);

  delete titles.dataset.pending;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduceMotion) {
    const animations = [titles.querySelector("svg").animate([
      { opacity: 0, filter: "blur(7px)", transform: "translateY(20px)" },
      { opacity: 1, filter: "blur(0px)", transform: "translateY(0)" },
    ], { duration: 790, easing: "cubic-bezier(.22,1,.36,1)", fill: "both" })];
    await Promise.allSettled(animations.map(animation => animation.finished));
    await new Promise(resolve => setTimeout(resolve, titleToSignaturePause));
  }


  ink.src = reduceMotion ? ink.dataset.src + "#still" : ink.dataset.src;
}

titles.dataset.pending = "";
const observer = new MutationObserver(startWhenReady);
observer.observe(root, { attributes: true, attributeFilter: ["class"] });
function startWhenReady() {
  if (root.classList.contains("about-starting")) return;
  observer.disconnect();
  revealCover();
}
startWhenReady();
