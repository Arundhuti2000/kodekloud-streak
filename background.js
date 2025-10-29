// background.js
function log(...args) {
  try {
    console.log("[KK-streak background]", ...args);
  } catch (e) {}
}

function todayKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function getDataMap() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      { activityMap: null, activityDates: null, totalXP: 0 },
      (res) => {
        // migration from activityDates -> activityMap
        if (res.activityMap && typeof res.activityMap === "object") {
          resolve({ map: res.activityMap, totalXP: Number(res.totalXP || 0) });
        } else if (Array.isArray(res.activityDates)) {
          const m = {};
          res.activityDates.forEach((d) => {
            m[d] = (m[d] || 0) + 1;
          });
          const totalXP = Object.values(m).reduce((s, c) => s + c * 100, 0);
          // save migration
          chrome.storage.sync.set(
            { activityMap: m, activityDates: [], totalXP },
            () => resolve({ map: m, totalXP })
          );
        } else {
          resolve({ map: {}, totalXP: Number(res.totalXP || 0) });
        }
      }
    );
  });
}

async function setData(map, totalXP) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ activityMap: map, totalXP: totalXP }, () =>
      resolve()
    );
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) return;

  if (msg.action === "recordToday") {
    (async () => {
      try {
        const KEY = todayKey();
        const { map: currMap = {}, totalXP: currXP = 0 } = await getDataMap();
        const map = Object.assign({}, currMap);
        map[KEY] = (map[KEY] || 0) + 1;
        // Each view = 100 XP
        const gained = 100;
        const totalXP = Object.values(map).reduce(
          (s, c) => s + Number(c || 0) * gained,
          0
        );
        await setData(map, totalXP);
        log("Recorded", KEY, "count now", map[KEY], "totalXP", totalXP);
        if (sendResponse)
          sendResponse({
            ok: true,
            key: KEY,
            count: map[KEY],
            gained,
            totalXP,
          });
      } catch (e) {
        log("Error recording date:", e);
        if (sendResponse) sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg.action === "getMap") {
    getDataMap().then(({ map, totalXP }) => {
      if (sendResponse)
        sendResponse({ map: map || {}, totalXP: Number(totalXP || 0) });
    });
    return true;
  }

  if (msg.action === "clearAll") {
    setData({}, 0).then(() => {
      if (sendResponse) sendResponse({ ok: true });
    });
    return true;
  }
});
