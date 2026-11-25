export const titleToSignaturePause = 190;

export function revealFocusLine(line, index) {
  return line.animate([
    { opacity: 0, filter: 'blur(.11em)', transform: 'translateY(.2em)' },
    { opacity: 1, filter: 'blur(0)', transform: 'translateY(0)' },
  ], {
    duration: 690,
    delay: index * 100,
    easing: 'cubic-bezier(.22, 1, .36, 1)',
    fill: 'both',
  });
}
