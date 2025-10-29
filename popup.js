// popup.js (replace entire file)
function todayKey(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function getMap() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "getMap" }, (res) => {
      resolve((res && res.map) || {});
    });
  });
}

function calcCurrentStreak(map) {
  let streak = 0;
  let i = 0;
  while (true) {
    const key = todayKey(-i);
    if (map[key] && map[key] > 0) {
      streak++;
      i++;
    } else break;
  }
  return streak;
}

function totalDays(map) {
  return Object.keys(map).filter((k) => map[k] > 0).length;
}

function colorBucket(count, maxCount) {
  // Absolute mapping of views → color bucket
  if (!count || count <= 0) return 0; // no activity
  if (count === 1) return 1; // 1 video → lightest blue
  if (count === 2) return 2; // 2 videos → medium blue
  if (count === 3) return 3; // 3 videos → strong blue
  return 4; // 4 or more → brightest blue
}

async function render() {
  const map = await getMap();
  const cur = calcCurrentStreak(map);
  const total = totalDays(map);
  document.getElementById("curStreak").textContent = cur;
  document.getElementById("totalDays").textContent = total;

  // find max count in the map for intensity scaling
  const counts = Object.values(map).map((v) => Number(v || 0));
  const maxCount = counts.length ? Math.max(...counts) : 1;

  // build last 365 days in GitHub-like layout (weeks across)
  const heat = document.getElementById("heatmap");
  heat.innerHTML = "";

  const totalDaysNum = 365;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (totalDaysNum - 1));
  const startDow = startDate.getDay();
  const weeks = Math.ceil((startDow + totalDaysNum) / 7);

  for (let w = 0; w < weeks; w++) {
    const weekDiv = document.createElement("div");
    weekDiv.className = "week";
    for (let day = 0; day < 7; day++) {
      const dayIndex = w * 7 + day - startDow;
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + dayIndex);
      const iso = d.toISOString().slice(0, 10);

      const cell = document.createElement("div");
      cell.className = "cell c0";

      const dayOffsetFromStart = (d - startDate) / (1000 * 60 * 60 * 24);
      const inRange =
        dayOffsetFromStart >= 0 && dayOffsetFromStart < totalDaysNum;
      if (!inRange) {
        cell.style.visibility = "hidden";
      } else {
        const cnt = map[iso] ? Number(map[iso]) : 0;
        const bucket = colorBucket(cnt, maxCount);
        cell.className = `cell c${bucket}`;
        cell.title = `${iso} — ${cnt} view${cnt === 1 ? "" : "s"}`;
      }
      weekDiv.appendChild(cell);
    }
    heat.appendChild(weekDiv);
  }

  // After building, auto-scroll to the end so recent days are visible (last 30 days)
  // tiny delay to ensure layout measured
  setTimeout(() => {
    // scroll to very end smoothly
    try {
      heat.scrollTo({ left: heat.scrollWidth, behavior: "smooth" });
      // as a fallback, directly set scrollLeft
      heat.scrollLeft = heat.scrollWidth;
    } catch (e) {
      heat.scrollLeft = heat.scrollWidth;
    }
  }, 50);
}

document.getElementById("clearBtn").addEventListener("click", () => {
  if (!confirm("Clear all stored activity data? This cannot be undone."))
    return;
  chrome.runtime.sendMessage({ action: "clearAll" }, (res) => {
    if (res && res.ok) render();
  });
});

render();
