function seoranYtSkip() {
  if (window.top !== window) { return; }
  const SKIP = '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, button[id^="skip-button"]';
  let inAd = false;
  let saved = null;
  const tick = () => {
    const player = document.querySelector('#movie_player, .html5-video-player');
    if (!player) { return; }
    const video = player.querySelector('video');
    const ad = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
    if (ad && video) {
      if (!inAd) { saved = { muted: video.muted, rate: video.playbackRate }; inAd = true; }
      video.muted = true;
      if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.1) {
        video.currentTime = video.duration;
      }
      for (const btn of document.querySelectorAll(SKIP)) { btn.click(); }
    } else if (inAd && video) {
      inAd = false;
      if (saved) { video.muted = saved.muted; video.playbackRate = saved.rate; }
      saved = null;
    }
  };
  setInterval(tick, 250);
}
