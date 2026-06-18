export interface LayoutItem { key: string; startMs: number; endMs: number }
export interface Lane { lane: number; lanes: number }

/**
 * Equal-lane overlap layout (Google-Calendar basic model). Items in the same overlap
 * *cluster* split into N lanes; each item takes lane index `lane` of `lanes` total.
 * Touching intervals (end === start) do not overlap and may share a lane.
 */
export function layoutOverlaps(items: LayoutItem[]): Map<string, Lane> {
  const result = new Map<string, Lane>();
  const sorted = [...items].sort(
    (a, b) => a.startMs - b.startMs || b.endMs - a.endMs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );

  let cluster: { key: string; endMs: number; lane: number }[] = [];
  let laneEnds: number[] = []; // last endMs per open lane in the current cluster
  let clusterMax = 0;          // max endMs in the current cluster

  const flush = () => {
    const lanes = laneEnds.length || 1;
    for (const c of cluster) result.set(c.key, { lane: c.lane, lanes });
    cluster = [];
    laneEnds = [];
    clusterMax = 0;
  };

  for (const it of sorted) {
    if (cluster.length > 0 && it.startMs >= clusterMax) flush(); // no overlap with the cluster → close it
    // first lane whose previous block has ended (end <= start); else a new lane
    let lane = laneEnds.findIndex((end) => end <= it.startMs);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.endMs); }
    else laneEnds[lane] = it.endMs;
    cluster.push({ key: it.key, endMs: it.endMs, lane });
    clusterMax = Math.max(clusterMax, it.endMs);
  }
  flush();
  return result;
}
