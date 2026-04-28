"""
Thermostat Hybrid Automaton Simulation
=======================================
Chapter 9 — Models and Tools for Cyber-Physical Systems

Hybrid automaton with two discrete modes:
  OFF:  T' = -k₂            (linear cooling)
  ON:   T' = k₁ · (70 - T)  (exponential heating toward 70°)

Guard conditions (mode switching):
  OFF → ON:  non-deterministic in T ∈ [60, 62], mandatory at T = 60
  ON → OFF:  non-deterministic in T ∈ [68, 70], mandatory at T = 70

Usage: mamba activate sims && python thermostat_hybrid.py
"""

import numpy as np
import matplotlib
matplotlib.use("TkAgg")
import matplotlib.pyplot as plt
from matplotlib.widgets import Slider, Button

# ── Physical parameters ─────────────────────────────────────────────────────
K1 = 0.1          # heating rate constant [1/s]
K2 = 0.5          # cooling rate [°/s]

# ── Temperature thresholds ──────────────────────────────────────────────────
T_LO = 60.0       # mandatory OFF → ON boundary
T_LO_ND = 62.0    # non-deterministic zone upper (OFF → ON)
T_HI_ND = 68.0    # non-deterministic zone lower (ON → OFF)
T_HI = 70.0       # mandatory ON → OFF boundary

# ── Simulation settings ────────────────────────────────────────────────────
DT = 0.01          # Euler step [s]
SIM_TIME = 120.0   # total horizon [s]

# ── Segment colours ─────────────────────────────────────────────────────────
COLOR_COOL = "#2166ac"   # dark blue  (OFF / cooling)
COLOR_HEAT = "#b2182b"   # dark red   (ON  / heating)


# ── Trajectory generation ──────────────────────────────────────────────────
def generate_trajectory():
    """Pre-compute the thermostat trajectory with random mode switches."""
    T0 = np.random.uniform(T_LO, T_HI)
    mode = 0  # 0 = OFF, 1 = ON

    n = int(SIM_TIME / DT)
    times = np.linspace(0, SIM_TIME, n + 1)
    temps = np.empty(n + 1)
    rates = np.empty(n + 1)
    modes = np.empty(n + 1, dtype=int)

    T = T0
    temps[0] = T0
    modes[0] = mode
    rates[0] = -K2

    # First switch threshold (OFF → ON): uniform in [T_LO, min(T_LO_ND, T0)]
    # so the threshold is reachable as T decreases from T0.
    switch_T = np.random.uniform(T_LO, min(T_LO_ND, T0))

    for i in range(n):
        rate = -K2 if mode == 0 else K1 * (T_HI - T)
        rates[i] = rate
        T += rate * DT

        if mode == 0 and T <= switch_T:
            T = max(T, T_LO)
            mode = 1
            switch_T = np.random.uniform(T_HI_ND, T_HI)
        elif mode == 1 and T >= switch_T:
            T = min(T, T_HI)
            mode = 0
            switch_T = np.random.uniform(T_LO, T_LO_ND)

        temps[i + 1] = T
        modes[i + 1] = mode

    rates[-1] = -K2 if modes[-1] == 0 else K1 * (T_HI - temps[-1])
    return times, temps, rates, modes


# ── Figure layout ───────────────────────────────────────────────────────────
fig, (ax_mode, ax_rate, ax_temp) = plt.subplots(
    3, 1, sharex=True, figsize=(13, 8),
    gridspec_kw={"height_ratios": [1, 1.5, 2], "hspace": 0.08},
)
fig.canvas.manager.set_window_title("Thermostat Hybrid Automaton — Ch. 9")
fig.subplots_adjust(bottom=0.14, top=0.93, left=0.08, right=0.96)
fig.suptitle("Thermostat Hybrid Automaton", fontsize=14, fontweight="bold")

# ── Mode axis (top) ────────────────────────────────────────────────────────
ax_mode.set_ylabel("Mode")
ax_mode.set_yticks([0, 1])
ax_mode.set_yticklabels(["OFF", "ON"])
ax_mode.set_ylim(-0.15, 1.15)
ax_mode.grid(True, alpha=0.3)
dot_mode, = ax_mode.plot([], [], "o", color=COLOR_COOL, ms=7, zorder=5)

# ── Rate axis (middle) ─────────────────────────────────────────────────────
ax_rate.set_ylabel("Rate  T'  [°/s]")
ax_rate.axhline(0, color="grey", ls="-", lw=0.5)
ax_rate.set_ylim(-K2 - 0.15, K1 * (T_HI - T_LO) + 0.15)
ax_rate.grid(True, alpha=0.3)
dot_rate, = ax_rate.plot([], [], "o", color=COLOR_COOL, ms=7, zorder=5)

# ── Temperature axis (bottom) ──────────────────────────────────────────────
ax_temp.set_ylabel("Temperature  T  [°]")
ax_temp.set_xlabel("Time  [s]")
# Background colour bands
ax_temp.axhspan(T_LO - 2, T_LO_ND, color="#d0e4f0", zorder=0)   # light blue
ax_temp.axhspan(T_LO_ND, T_HI_ND,  color="#fde8c9", zorder=0)   # light orange
ax_temp.axhspan(T_HI_ND, T_HI + 2,  color="#f4cccc", zorder=0)   # light red
# Boundary dashed lines
ax_temp.axhline(T_LO, color="grey", ls="--", lw=1.2, zorder=1)
ax_temp.axhline(T_HI, color="grey", ls="--", lw=1.2, zorder=1)
ax_temp.text(SIM_TIME + 1, T_LO, f"T = {T_LO:.0f}",
             va="center", fontsize=9, color="grey")
ax_temp.text(SIM_TIME + 1, T_HI, f"T = {T_HI:.0f}",
             va="center", fontsize=9, color="grey")
ax_temp.set_ylim(T_LO - 2, T_HI + 2)
ax_temp.set_xlim(0, SIM_TIME)
ax_temp.grid(True, alpha=0.3, zorder=1)
dot_temp, = ax_temp.plot([], [], "o", color=COLOR_COOL, ms=7, zorder=5)

# ── Time slider ────────────────────────────────────────────────────────────
slider_ax = fig.add_axes([0.08, 0.04, 0.78, 0.025])
slider = Slider(slider_ax, "t", 0, SIM_TIME, valinit=0)

# ── Reset button (placed to the right, clear of the slider value label) ───
reset_ax = fig.add_axes([0.92, 0.035, 0.05, 0.035])
reset_btn = Button(reset_ax, "Reset", hovercolor="0.85")


# ── State ───────────────────────────────────────────────────────────────────
state = {"lines": [], "vlines": []}


def init():
    """Generate a new trajectory and create per-segment artists."""
    times, temps, rates, modes = generate_trajectory()
    state["times"] = times
    state["temps"] = temps
    state["rates"] = rates
    state["modes"] = modes

    # Remove previous segment lines and switch markers
    for seg in state["lines"]:
        seg["temp"].remove()
        seg["rate"].remove()
        seg["mode"].remove()
    for vl in state["vlines"]:
        vl["temp"].remove()
        vl["rate"].remove()
        vl["mode"].remove()
    state["lines"] = []
    state["vlines"] = []

    # Compute segment boundaries from mode switches
    switch_idx = np.where(np.diff(modes) != 0)[0] + 1
    bounds = np.concatenate([[0], switch_idx, [len(modes)]])

    # Create coloured line artists for each segment
    for j in range(len(bounds) - 1):
        s, e = int(bounds[j]), int(bounds[j + 1])
        color = COLOR_COOL if modes[s] == 0 else COLOR_HEAT
        ln_t, = ax_temp.plot([], [], color=color, lw=1.8, zorder=2)
        ln_r, = ax_rate.plot([], [], color=color, lw=1.5, zorder=2)
        ln_m, = ax_mode.plot([], [], drawstyle="steps-post",
                             color=color, lw=2, zorder=2)
        state["lines"].append({
            "start": s, "end": e,
            "temp": ln_t, "rate": ln_r, "mode": ln_m,
        })

    # Create vertical dotted lines at each mode switch
    for si in switch_idx:
        t_sw = times[int(si)]
        vl_t = ax_temp.axvline(t_sw, color="black", ls=":", lw=1,
                               visible=False, zorder=3)
        vl_r = ax_rate.axvline(t_sw, color="black", ls=":", lw=1,
                               visible=False, zorder=3)
        vl_m = ax_mode.axvline(t_sw, color="black", ls=":", lw=1,
                               visible=False, zorder=3)
        state["vlines"].append({
            "idx": int(si),
            "temp": vl_t, "rate": vl_r, "mode": vl_m,
        })


def update(val):
    """Reveal the trajectory up to the current slider position."""
    idx = max(1, int(slider.val / DT) + 1)
    idx = min(idx, len(state["times"]))
    i = idx - 1

    times = state["times"]
    temps = state["temps"]
    rates = state["rates"]
    modes = state["modes"]

    # Update each segment's visible portion
    for seg in state["lines"]:
        s, e = seg["start"], seg["end"]
        if idx <= s:
            # Segment not yet reached
            seg["temp"].set_data([], [])
            seg["rate"].set_data([], [])
            seg["mode"].set_data([], [])
        else:
            vis_end = min(e, idx)
            sl = slice(s, vis_end)
            seg["temp"].set_data(times[sl], temps[sl])
            seg["rate"].set_data(times[sl], rates[sl])
            seg["mode"].set_data(times[sl], modes[sl])

    # Show/hide vertical switch markers
    for vl in state["vlines"]:
        visible = vl["idx"] < idx
        vl["temp"].set_visible(visible)
        vl["rate"].set_visible(visible)
        vl["mode"].set_visible(visible)

    # Current-position dot (colour matches current mode)
    color = COLOR_COOL if modes[i] == 0 else COLOR_HEAT
    dot_temp.set_data([times[i]], [temps[i]])
    dot_temp.set_color(color)
    dot_rate.set_data([times[i]], [rates[i]])
    dot_rate.set_color(color)
    dot_mode.set_data([times[i]], [modes[i]])
    dot_mode.set_color(color)

    fig.canvas.draw_idle()


def on_reset(_event):
    init()
    slider.set_val(0)


slider.on_changed(update)
reset_btn.on_clicked(on_reset)

init()
update(0)
plt.show()
