// Which channel the Viewer tab's monitor is showing.
//
// The monitor windows down to ~12 seconds, so it fetches the SELECTED channel
// at full resolution rather than reusing the timeline lane's decimated
// min/max envelope (which reads as a zigzag at that zoom). Until that fetch
// lands there has to be something on screen.
//
// ★ The bug this exists to prevent: the fallback used to be
//
//     channels.find((c) => c.name === monitorChannelName) || channels[0]
//
// so whenever the name did not resolve — during a device switch, or before
// `channels` had reloaded — the monitor silently rendered a DIFFERENT
// channel's curve while the label still named the one the user picked.
// Reported as "each time I go to the funscript I see something different",
// and it is unfalsifiable from the UI: frequency and volume are both smooth
// curves, so the wrong one looks perfectly plausible.
//
// Showing nothing is strictly better than showing the wrong signal
// confidently. A monitor that lies about which channel it is displaying is
// worse than one that is briefly blank.

/**
 * Resolve the monitor's funscript.
 *
 * @param fullRes   full-resolution actions for the selected channel, or []
 * @param channels  timeline lanes: [{ name, actions }] (decimated)
 * @param name      the selected channel name
 * @returns { actions, provisional } — `provisional` means these are the
 *          decimated lane actions, not the real strokes, so a caller that
 *          wants to say so has the flag. Never another channel's data.
 */
export function resolveMonitorFunscript(fullRes, channels, name) {
  if (Array.isArray(fullRes) && fullRes.length) {
    return { actions: fullRes, provisional: false };
  }
  // Same channel only. No `|| channels[0]`.
  const lane = (channels ?? []).find((c) => c && c.name === name);
  if (lane && Array.isArray(lane.actions) && lane.actions.length) {
    return { actions: lane.actions, provisional: true };
  }
  return { actions: [], provisional: false };
}
