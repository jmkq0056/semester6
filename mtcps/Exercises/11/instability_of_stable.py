"""
Two-Mode Linear Hybrid System
==============================
Chapter 9 — Models and Tools for Cyber-Physical Systems

Mode A:  x' = -x - 100·y,   y' = 10·x - y    invariant:  y ≥ -0.2·x
Mode B:  x' = -x +  10·y,   y' = -100·x - y  invariant:  y ≥  5·x

Radio-button options:
  * Mode A only:  evolve A's ODE; stop when the invariant is violated.
  * Mode B only:  evolve B's ODE; stop when the invariant is violated.
  * Combined:     start in A, jump to B at y = -0.2·x,
                  jump back to A at y = 5·x, repeatedly.

Usage: mamba activate sims && python hybrid_two_modes.py
"""

import numpy as np
import matplotlib
matplotlib.use("TkAgg")
import matplotlib.pyplot as plt
from matplotlib.widgets import Slider, Button, RadioButtons, CheckButtons

# ── Simulation settings ────────────────────────────────────────────────────
DT = 0.0005
SIM_TIME = 1.0          # total horizon [s]

# ── Colours ─────────────────────────────────────────────────────────────────
COLOR_A = "#1f77b4"     # blue — mode A
COLOR_B = "#d62728"     # red  — mode B


# ── ODEs ───────────────────────────────────────────────────────────────────
def ode_A(x, y):
    return -x - 100.0 * y, 10.0 * x - y


def ode_B(x, y):
    return -x + 10.0 * y, -100.0 * x - y


def rk4(f, x, y, dt):
    k1x, k1y = f(x, y)
    k2x, k2y = f(x + 0.5 * dt * k1x, y + 0.5 * dt * k1y)
    k3x, k3y = f(x + 0.5 * dt * k2x, y + 0.5 * dt * k2y)
    k4x, k4y = f(x + dt * k3x,       y + dt * k3y)
    return (x + dt / 6.0 * (k1x + 2.0 * k2x + 2.0 * k3x + k4x),
            y + dt / 6.0 * (k1y + 2.0 * k2y + 2.0 * k3y + k4y))


def inv_A(x, y):  return y >= -0.2 * x
def inv_B(x, y):  return y >=  5.0 * x


# ── Simulation ──────────────────────────────────────────────────────────────
def simulate(mode, x0, y0, use_guard=True):
    """mode ∈ {'A', 'B', 'combined'}. Returns (times, xs, ys, modes).

    When use_guard is False, invariants are ignored: single modes evolve
    their ODE forever (showing the stable spiral), and the combined mode
    stays in its initial mode since there is no trigger to switch.
    """
    n = int(SIM_TIME / DT)
    times = np.linspace(0.0, SIM_TIME, n + 1)
    xs    = np.empty(n + 1)
    ys    = np.empty(n + 1)
    modes = np.empty(n + 1, dtype=int)    # 0 = A, 1 = B

    cur = 1 if mode == "B" else 0
    x, y = x0, y0
    xs[0], ys[0], modes[0] = x, y, cur
    stopped = False

    # Cap amplitude so the switching-induced blow-up of the combined mode
    # doesn't rescale axes into uselessness.
    amp_cap = 10.0 * max(abs(x0), abs(y0), 1.0)

    for i in range(n):
        if stopped:
            xs[i + 1], ys[i + 1], modes[i + 1] = x, y, cur
            continue

        f   = ode_A if cur == 0 else ode_B
        inv = inv_A if cur == 0 else inv_B
        xn, yn = rk4(f, x, y, DT)

        if use_guard and not inv(xn, yn):
            if mode == "combined":
                cur = 1 - cur      # jump; state is preserved
            else:
                stopped = True
                xn, yn = x, y      # freeze at the boundary

        if abs(xn) > amp_cap or abs(yn) > amp_cap:
            stopped = True
            xn, yn = x, y

        x, y = xn, yn
        xs[i + 1], ys[i + 1], modes[i + 1] = x, y, cur

    return times, xs, ys, modes


# ── Figure layout ───────────────────────────────────────────────────────────
fig = plt.figure(figsize=(14, 8))
fig.canvas.manager.set_window_title("Hybrid Two-Mode Linear System — Ch. 9")

gs = fig.add_gridspec(2, 2,
                      height_ratios=[1, 1], width_ratios=[1.4, 1],
                      hspace=0.10, wspace=0.22,
                      top=0.90, bottom=0.15, left=0.22, right=0.97)
ax_x     = fig.add_subplot(gs[0, 0])
ax_y     = fig.add_subplot(gs[1, 0], sharex=ax_x)
ax_phase = fig.add_subplot(gs[:, 1])

title_text = fig.suptitle("Hybrid Two-Mode Linear System",
                          fontsize=14, fontweight="bold", y=0.95)

# ── x(t) axis ───────────────────────────────────────────────────────────────
ax_x.set_ylabel("x(t)")
ax_x.axhline(0, color="grey", lw=0.5)
ax_x.grid(True, alpha=0.3)
plt.setp(ax_x.get_xticklabels(), visible=False)
ax_x.set_xlim(0.0, SIM_TIME)

# ── y(t) axis ───────────────────────────────────────────────────────────────
ax_y.set_ylabel("y(t)")
ax_y.set_xlabel("Time  [s]")
ax_y.axhline(0, color="grey", lw=0.5)
ax_y.grid(True, alpha=0.3)

# ── Phase-portrait axis ────────────────────────────────────────────────────
ax_phase.set_xlabel("x")
ax_phase.set_ylabel("y")
ax_phase.set_title("Phase portrait  (y vs x)", fontsize=11)
ax_phase.axhline(0, color="grey", lw=0.5, zorder=0)
ax_phase.axvline(0, color="grey", lw=0.5, zorder=0)
ax_phase.grid(True, alpha=0.3)
ax_phase.set_aspect("equal", adjustable="box")

# Guard lines (shown selectively in init())
line_guardA = ax_phase.axline((0, 0), slope=-0.2, color=COLOR_A,
                              ls="--", lw=1, alpha=0.7,
                              label=r"$y = -0.2\,x$  (A)")
line_guardB = ax_phase.axline((0, 0), slope=5.0,  color=COLOR_B,
                              ls="--", lw=1, alpha=0.7,
                              label=r"$y = 5\,x$  (B)")
legend_phase = ax_phase.legend(loc="upper right", fontsize=8)

# Current-position dots
dot_x,     = ax_x.plot([], [], "o", color=COLOR_A, ms=7, zorder=6)
dot_y,     = ax_y.plot([], [], "o", color=COLOR_A, ms=7, zorder=6)
dot_phase, = ax_phase.plot([], [], "o", color=COLOR_A, ms=9, zorder=6)

# ── Slider ─────────────────────────────────────────────────────────────────
slider_ax = fig.add_axes([0.22, 0.05, 0.62, 0.025])
slider = Slider(slider_ax, "t", 0.0, SIM_TIME, valinit=0.0)

# ── Reset button ───────────────────────────────────────────────────────────
reset_ax = fig.add_axes([0.91, 0.045, 0.06, 0.035])
reset_btn = Button(reset_ax, "Reset", hovercolor="0.85")

# ── Radio buttons for mode selection ───────────────────────────────────────
radio_ax = fig.add_axes([0.02, 0.68, 0.16, 0.20])
radio_ax.set_frame_on(False)
radio = RadioButtons(radio_ax, ("Mode A", "Mode B", "Combined"), active=0)

# ── Guard-enable checkbox ──────────────────────────────────────────────────
check_ax = fig.add_axes([0.02, 0.48, 0.16, 0.10])
check_ax.set_frame_on(False)
check_guard = CheckButtons(check_ax, ["Guard"], [True])
check_guard.labels[0].set_fontsize(11)


# ── State ───────────────────────────────────────────────────────────────────
state = {"lines": [], "use_guard": True}


def current_mode_key():
    return {"Mode A": "A",
            "Mode B": "B",
            "Combined": "combined"}[radio.value_selected]


def clear_segment_lines():
    for seg in state["lines"]:
        seg["x"].remove()
        seg["y"].remove()
        seg["phase"].remove()
    state["lines"] = []


def init():
    """Generate the trajectory for the selected mode."""
    mode = current_mode_key()
    state["mode"] = mode

    # Initial condition — always valid in all three modes (y≈1 > max(5x, -0.2x) for small x)
    x0 = np.random.uniform(-0.05, 0.05)
    y0 = np.random.uniform(0.95, 1.05)
    state["x0"], state["y0"] = x0, y0

    times, xs, ys, modes = simulate(mode, x0, y0, use_guard=state["use_guard"])
    state["times"], state["xs"], state["ys"], state["modes"] = times, xs, ys, modes

    clear_segment_lines()

    # Mode-switch boundaries → coloured segments
    switch_idx = np.where(np.diff(modes) != 0)[0] + 1
    bounds = np.concatenate([[0], switch_idx, [len(modes)]])

    for j in range(len(bounds) - 1):
        s, e  = int(bounds[j]), int(bounds[j + 1])
        color = COLOR_A if modes[s] == 0 else COLOR_B
        ln_x, = ax_x.plot([],     [], color=color, lw=1.3, zorder=2)
        ln_y, = ax_y.plot([],     [], color=color, lw=1.3, zorder=2)
        ln_p, = ax_phase.plot([], [], color=color, lw=1.3, zorder=2)
        state["lines"].append({
            "start": s, "end": e, "color": color,
            "x": ln_x, "y": ln_y, "phase": ln_p,
        })

    # Show guard lines relevant to the active mode (only if guards are enforced)
    show = state["use_guard"]
    line_guardA.set_visible(show and mode in ("A", "combined"))
    line_guardB.set_visible(show and mode in ("B", "combined"))

    # Axis limits based on the actual data
    x_amp = max(float(np.max(np.abs(xs))), 0.5) * 1.15
    y_amp = max(float(np.max(np.abs(ys))), 0.5) * 1.15
    ax_x.set_ylim(-x_amp, x_amp)
    ax_y.set_ylim(-y_amp, y_amp)
    lim = max(x_amp, y_amp)
    ax_phase.set_xlim(-lim, lim)
    ax_phase.set_ylim(-lim, lim)

    # Title with mode, guard status, and initial conditions
    guard_tag = "guard on" if state["use_guard"] else "guard off"
    title_text.set_text(
        f"Hybrid Two-Mode System    "
        f"[{radio.value_selected}, {guard_tag}]    "
        f"x₀ = {x0:+.2f},  y₀ = {y0:+.2f}"
    )


def update(val):
    """Reveal the trajectory up to the current slider position."""
    if not state["lines"]:
        return
    idx = max(1, int(slider.val / DT) + 1)
    idx = min(idx, len(state["times"]))
    i = idx - 1

    times = state["times"]
    xs    = state["xs"]
    ys    = state["ys"]
    modes = state["modes"]

    for seg in state["lines"]:
        s, e = seg["start"], seg["end"]
        if idx <= s:
            seg["x"].set_data([], [])
            seg["y"].set_data([], [])
            seg["phase"].set_data([], [])
        else:
            ve = min(e, idx)
            sl = slice(s, ve)
            seg["x"].set_data(times[sl], xs[sl])
            seg["y"].set_data(times[sl], ys[sl])
            seg["phase"].set_data(xs[sl], ys[sl])

    color = COLOR_A if modes[i] == 0 else COLOR_B
    dot_x.set_data([times[i]], [xs[i]]);    dot_x.set_color(color)
    dot_y.set_data([times[i]], [ys[i]]);    dot_y.set_color(color)
    dot_phase.set_data([xs[i]], [ys[i]]);   dot_phase.set_color(color)

    fig.canvas.draw_idle()


def on_reset(_event):
    init()
    slider.set_val(0.0)


def on_mode(_label):
    init()
    update(slider.val)


def on_guard(_label):
    state["use_guard"] = not state["use_guard"]
    init()
    update(slider.val)


slider.on_changed(update)
reset_btn.on_clicked(on_reset)
radio.on_clicked(on_mode)
check_guard.on_clicked(on_guard)

init()
update(0.0)
plt.show()
