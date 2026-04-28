"""
Bouncing Ball Hybrid Automaton Simulation
==========================================
Chapter 9 — Models and Tools for Cyber-Physical Systems

Continuous dynamics (free fall):
  x' = v          (height)
  v' = -g         (velocity)

Discrete transition (bounce at x = 0):
  v := -c · v    (0 < c < 1, chosen randomly per run)

Non-Zeno guard (checkbox):
  If |v| < ε at a bounce → v := 0  (ball comes to rest)

Usage: mamba activate sims && python bouncing_ball.py
"""

import numpy as np
import matplotlib
matplotlib.use("TkAgg")
import matplotlib.pyplot as plt
from matplotlib.widgets import Slider, Button, CheckButtons

# ── Physical parameters ─────────────────────────────────────────────────────
G = 10.0           # gravity [m/s²]
X0 = 5.0           # initial height [m]  (first bounce at t = 1 s)
V_THRESHOLD = 0.8  # non-Zeno velocity cutoff [m/s]

# ── Simulation settings ────────────────────────────────────────────────────
DT = 0.001          # Euler step [s]
SIM_TIME = 15.0     # total horizon [s]

# ── Colours ─────────────────────────────────────────────────────────────────
COLOR_POS = "#d62728"   # red  — height (always)
COLOR_VEL = "#1f77b4"   # blue — velocity


# ── Trajectory computation ─────────────────────────────────────────────────
def compute_trajectory(c, non_zeno):
    """Simulate the bouncing ball via Euler integration.

    Returns (times, heights, velocities).
    """
    n = int(SIM_TIME / DT)
    times = np.linspace(0, SIM_TIME, n + 1)
    heights = np.empty(n + 1)
    vels = np.empty(n + 1)

    x, v = X0, 0.0
    heights[0] = x
    vels[0] = v
    stopped = False

    for i in range(n):
        if stopped:
            heights[i + 1] = 0.0
            vels[i + 1] = 0.0
            continue

        v -= G * DT
        x += v * DT

        if x <= 0.0:
            x = 0.0
            if non_zeno and abs(v) < V_THRESHOLD:
                v = 0.0
                stopped = True
            else:
                v = -c * v

        heights[i + 1] = x
        vels[i + 1] = v

    return times, heights, vels


# ── Figure layout ───────────────────────────────────────────────────────────
fig, (ax_vel, ax_pos) = plt.subplots(
    2, 1, sharex=True, figsize=(13, 7),
    gridspec_kw={"height_ratios": [1, 1.2], "hspace": 0.08},
)
fig.canvas.manager.set_window_title("Bouncing Ball — Ch. 9")
fig.subplots_adjust(bottom=0.14, top=0.89, left=0.08, right=0.96)

title_text = fig.suptitle("Bouncing Ball    c = ?",
                          fontsize=14, fontweight="bold", y=0.96)

# ── Velocity axis (top) ────────────────────────────────────────────────────
ax_vel.set_ylabel("Velocity  v  [m/s]")
ax_vel.axhline(0, color="grey", ls="-", lw=0.5)
ax_vel.grid(True, alpha=0.3)
line_vel, = ax_vel.plot([], [], color=COLOR_VEL, lw=1.5)
dot_vel, = ax_vel.plot([], [], "o", color=COLOR_VEL, ms=7, zorder=5)

# ── Height axis (bottom) ───────────────────────────────────────────────────
ax_pos.set_ylabel("Height  x  [m]")
ax_pos.set_xlabel("Time  [s]")
ax_pos.axhline(0, color="grey", ls="--", lw=1.2)
ax_pos.set_ylim(-0.3, X0 + 1)
ax_pos.set_xlim(0, SIM_TIME)
ax_pos.grid(True, alpha=0.3)
line_pos, = ax_pos.plot([], [], color=COLOR_POS, lw=1.8)
dot_pos, = ax_pos.plot([], [], "o", color=COLOR_POS, ms=7, zorder=5)

# ── Time slider ────────────────────────────────────────────────────────────
slider_ax = fig.add_axes([0.08, 0.04, 0.78, 0.025])
slider = Slider(slider_ax, "t", 0, SIM_TIME, valinit=0)

# ── Reset button ────────────────────────────────────────────────────────────
reset_ax = fig.add_axes([0.92, 0.035, 0.05, 0.035])
reset_btn = Button(reset_ax, "Reset", hovercolor="0.85")

# ── Non-Zeno checkbox (ticked by default) ──────────────────────────────────
check_ax = fig.add_axes([0.02, 0.90, 0.15, 0.06])
check_ax.set_frame_on(False)
check_nz = CheckButtons(check_ax, ["Non-Zeno"], [True])
check_nz.labels[0].set_fontsize(11)


# ── State ───────────────────────────────────────────────────────────────────
state = {"non_zeno": True}


def init():
    """Generate both trajectory variants (with/without non-Zeno) for a new c."""
    c = np.random.uniform(0.3, 0.95)
    state["c"] = c
    state["non_zeno"] = True

    times, h_nz, v_nz = compute_trajectory(c, non_zeno=True)
    _, h_z, v_z = compute_trajectory(c, non_zeno=False)

    state["times"] = times
    state["h_nz"] = h_nz
    state["v_nz"] = v_nz
    state["h_z"] = h_z
    state["v_z"] = v_z

    title_text.set_text(f"Bouncing Ball    c = {c:.3f}")

    # Velocity axis limits (first-impact speed dominates)
    v_peak = max(np.max(np.abs(v_nz)), np.max(np.abs(v_z)))
    ax_vel.set_ylim(-v_peak * 1.1, v_peak * 1.1)


def active_data():
    """Return (heights, velocities) for the currently selected mode."""
    if state["non_zeno"]:
        return state["h_nz"], state["v_nz"]
    return state["h_z"], state["v_z"]


def update(val):
    """Reveal the trajectory up to the current slider position."""
    idx = max(1, int(slider.val / DT) + 1)
    idx = min(idx, len(state["times"]))
    i = idx - 1
    s = slice(0, idx)

    h, v = active_data()
    times = state["times"]

    line_pos.set_data(times[s], h[s])
    line_vel.set_data(times[s], v[s])

    dot_pos.set_data([times[i]], [h[i]])
    dot_vel.set_data([times[i]], [v[i]])

    fig.canvas.draw_idle()


def on_reset(_event):
    init()
    slider.set_val(0)


def on_check(_label):
    state["non_zeno"] = not state["non_zeno"]
    update(slider.val)


slider.on_changed(update)
reset_btn.on_clicked(on_reset)
check_nz.on_clicked(on_check)

init()
update(0)
plt.show()
