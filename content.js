// content.js
(() => {
  function log(...args) {
    try {
      console.log("[KK-streak content]", ...args);
    } catch (e) {}
  }

  log(
    "content script running in",
    window.location.href,
    "frame:",
    window.frameElement ? "iframe" : "top"
  );

  // Get today's date key in local timezone
  function todayKey() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  // Check if we've already recorded today
  async function hasRecordedToday() {
    return new Promise((resolve) => {
      const key = `recorded_${todayKey()}`;
      try {
        chrome.storage.local.get([key], (res) => {
          resolve(!!res[key]);
        });
      } catch (e) {
        log("storage check error:", e);
        resolve(false);
      }
    });
  }

  // Mark that we've recorded today
  async function markRecordedToday() {
    const key = `recorded_${todayKey()}`;
    try {
      await chrome.storage.local.set({ [key]: true });
    } catch (e) {
      log("storage set error:", e);
    }
  }

  // guard: chrome.runtime may not be available in some frames; wrap calls
  async function sendRecord(extra = {}) {
    // Check if already recorded today
    const alreadyRecorded = await hasRecordedToday();
    if (alreadyRecorded) {
      log("Already recorded today - skipping");
      return;
    }

    try {
      chrome.runtime.sendMessage(
        { action: "recordToday", ts: Date.now(), ...extra },
        (r) => {
          log("bg ack", r);
          if (r && r.ok) {
            markRecordedToday();
          }
        }
      );
    } catch (e) {
      log("chrome.runtime not available here:", e);
    }
  }

  // per-element watcher
  function setupWatcher(video) {
    if (!video || video._kk_streak_attached) return;
    video._kk_streak_attached = true;

    const MIN_SECONDS = 60; // minimum seconds watched to count if video not ended
    const MIN_FRAC = 0.5; // or minimum fraction of duration watched
    let sessionWatched = 0; // cumulative seconds watched in this "session"
    let lastTime = null;
    let recordedThisVideo = false; // local debounce per video element

    async function tryRecord(reason) {
      if (recordedThisVideo) return;

      // Check global flag before recording
      const alreadyRecorded = await hasRecordedToday();
      if (alreadyRecorded) {
        log("Already recorded today globally - skipping");
        return;
      }

      recordedThisVideo = true;
      log("Recording today because:", reason);
      await sendRecord({ reason });
    }

    // called frequently by 'timeupdate' - measure delta time
    function onTimeUpdate() {
      const t = video.currentTime;
      if (lastTime == null) {
        lastTime = t;
        return;
      }
      // if seek backwards, don't count negative deltas
      const delta = Math.max(0, t - lastTime);
      sessionWatched += delta;
      lastTime = t;
      // check thresholds live (in case people pause)
      const dur = video.duration || 0;
      if (dur > 0) {
        const frac = sessionWatched / dur;
        if (sessionWatched >= MIN_SECONDS || frac >= MIN_FRAC) {
          tryRecord(
            `watched ${Math.round(sessionWatched)}s (${(frac * 100).toFixed(
              0
            )}%)`
          );
        }
      } else {
        if (sessionWatched >= MIN_SECONDS) {
          tryRecord(`watched ${Math.round(sessionWatched)}s (no duration)`);
        }
      }
    }

    video.addEventListener("timeupdate", onTimeUpdate, { passive: true });

    video.addEventListener(
      "ended",
      () => {
        tryRecord("ended event");
      },
      { passive: true }
    );

    video.addEventListener(
      "pause",
      () => {
        // when user pauses, give one last chance if thresholds met
        onTimeUpdate();
        // no immediate record here unless threshold hit (onTimeUpdate would have recorded)
        log("video paused; sessionWatched:", Math.round(sessionWatched));
      },
      { passive: true }
    );

    // reset lastTime when seeking drastically or when playback restarts
    video.addEventListener(
      "seeking",
      () => {
        lastTime = video.currentTime;
      },
      { passive: true }
    );
    video.addEventListener(
      "play",
      () => {
        // resume: set lastTime
        lastTime = video.currentTime;
        log("video play event, currentTime:", lastTime);
      },
      { passive: true }
    );

    // cleanup if element removed
    const mo = new MutationObserver(() => {
      if (!document.contains(video)) {
        try {
          video.removeEventListener("timeupdate", onTimeUpdate);
        } catch (e) {}
        mo.disconnect();
      }
    });
    mo.observe(document, { childList: true, subtree: true });

    log("attached watcher to video", video);
  }

  // attach to native video elements
  function attachToVideos(root = document) {
    try {
      const vids = root.querySelectorAll("video");
      vids.forEach((v) => setupWatcher(v));
      if (vids.length) log("attachToVideos found", vids.length);
    } catch (e) {
      log("attachToVideos error", e);
    }
  }
  attachToVideos();

  // observe DOM for dynamic players / iframes
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (!m.addedNodes) continue;
      m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        if (n.tagName && n.tagName.toLowerCase() === "video") {
          setupWatcher(n);
        } else {
          attachToVideos(n);
        }
      });
    }
  });
  obs.observe(document, { childList: true, subtree: true });

  // Listen for Vimeo postMessage play events as a fallback (player API)
  window.addEventListener(
    "message",
    async (ev) => {
      try {
        const d = ev.data || {};
        if (typeof d === "object" && d.event === "play") {
          // don't immediately record on play — we want to wait until enough watched
          log(
            "vimeo postMessage play received — will wait for ended or time thresholds"
          );
          // nothing immediate; the iframe context should have a video element and record there
        }
        if (typeof d === "object" && d.event === "ended") {
          // if a vimeo 'ended' message arrives in this frame, record
          log("vimeo postMessage ended -> record");
          await sendRecord({ reason: "vimeo-ended" });
        }
      } catch (e) {}
    },
    false
  );

  // expose helper for debugging from page console
  window.__kk_record_today = () => sendRecord({ manual: true });
  window.__kk_attach_videos = attachToVideos;
})();
