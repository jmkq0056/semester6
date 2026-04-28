"""
PID Controller Simulation for a DC Motor
=========================================

DC Motor model (two coupled ODEs):
    w' = (k * I - b * w) / J
    I' = (V - k * w - R * I) / L

where:
    w  — angular velocity [rad/s]
    I  — armature current [A]
    V  — input voltage (control signal) [V]
    k  — EMF constant [V·s/rad]
    b  — viscous friction coefficient [N·m·s/rad]
    J  — moment of inertia [kg·m²]
    R  — armature resistance [Ω]
    L  — armature inductance [H]

PID control law:
    e(t) = v - w(t)                        (error)
    V(t) = Kp·e + Ki·∫e dt + Kd·de/dt
"""

import numpy as np
from scipy.integrate import solve_ivp
import matplotlib
matplotlib.use("TkAgg")
import matplotlib.pyplot as plt
from matplotlib.widgets import CheckButtons, TextBox, Button, Slider

# ── Default physical parameters ──────────────────────────────────────────────
DEFAULTS = dict(J=0.01, b=0.1, k=0.01, R=1.0, L=0.5)
# dict(J=0.01, b=0.1, k=0.01, R=1.0, L=0.5)

# ── Default control parameters ───────────────────────────────────────────────
KP_DEFAULT = 100.0
KI_DEFAULT = 200.0
KD_DEFAULT = 1.0
W_SETPOINt = 1.0  # desired angular velocity [rad/s]

# ── Default simulation horizon ───────────────────────────────────────────────
T_MAX_DEFAULT = 2.0


# ── Simulation core ─────────────────────────────────────────────────────────
def simulate(Kp, Ki, Kd, sp=W_SETPOINt, t_max=T_MAX_DEFAULT, params=None):
    """Run the DC-motor + PID simulation and return (t, w)."""
    p = {**DEFAULTS, **(params or {})}
    J, b, k, R, L = p["J"], p["b"], p["k"], p["R"], p["L"]

    t_eval = np.linspace(0.0, t_max, max(int(1000 * t_max), 2000))

    # State vector: [w, I, integral_of_error]
    def rhs(t, y):
        # pos, vel, int_e = y
        # e = sp - pos
        # vel = Kp * e + Ki * int_e - Kd * vel
        # dposdt = vel
        # dveldt = 0
        # return [dposdt, dveldt, e]
        w, I, int_e = y
        e = sp - w
        dwdt = (k * I - b * w) / J
        V = Kp * e + Ki * int_e + Kd * (-dwdt)  # de/dt ≈ -dw/dt
        dIdt = (V - k * w - R * I) / L
        return [dwdt, dIdt, e]

    sol = solve_ivp(rhs, (0.0, t_max), [0.0, 0.0, 0.0], t_eval=t_eval,
                    method="RK45", rtol=1e-8, atol=1e-10)
    return sol.t, sol.y[0]


# ── Colour palette ──────────────────────────────────────────────────────────
#  Compare-all shows P, PI, PD, PID so the student can see the individual
#  effect of the integral and derivative terms, and their combination.
CMP_STYLES = {
    "P":   dict(color="#1f77b4", label="P   (Kp)"),
    "PI":  dict(color="#ff7f0e", label="PI  (Kp + Ki)"),
    "PD":  dict(color="#2ca02c", label="PD  (Kp + Kd)"),
    "PID": dict(color="#d62728", label="PID (Kp + Ki + Kd)"),
}
CMP_KEYS = ("P", "PI", "PD", "PID")
MAIN_COLOR = "#9467bd"  # colour for the checkbox-driven curve


# ── Build the figure ────────────────────────────────────────────────────────
fig = plt.figure("PID Controller — DC Motor", figsize=(14, 9))
fig.subplots_adjust(left=0.26, right=0.96, top=0.82, bottom=0.08)

# ── Equations label at the top ──────────────────────────────────────────────
eq_text = (
    r"DC Motor:   $\dot{\omega} = \frac{k\cdot I \;-\; b\cdot\omega}{J}$"
    r"$\qquad$"
    r"$\dot{I} = \frac{V \;-\; k\cdot\omega \;-\; R\cdot I}{L}$"
    "\n"
    r"PID Control:   $V = K_p\cdot e \;+\; K_i\cdot \!\int e\,dt \;+\; K_d\cdot\dot{e}$"
    r"$\qquad$"
    r"where $\; e(t) = SP - \omega(t)$"
)
fig.text(0.61, 0.92, eq_text, fontsize=11, ha="center", va="center",
         linespacing=1.5,
         bbox=dict(boxstyle="round,pad=0.4", facecolor="wheat", alpha=0.5))

# ── Main axes ───────────────────────────────────────────────────────────────
ax = fig.add_subplot(111)
ax.set_xlabel("Time [s]")
ax.set_ylabel(r"Angular velocity  $\omega$  [rad/s]")
ax.set_title("DC Motor speed response under PID control")
ax.set_xlim(0, T_MAX_DEFAULT)
ax.grid(True, alpha=0.3)

# Setpoint dashed line
setpoint_line = ax.axhline(W_SETPOINt, color="grey", ls="--", lw=1.5,
                           label=f"Setpoint v = {W_SETPOINt}")

# Main curve (driven by P / I / D checkboxes)
line_main, = ax.plot([], [], color=MAIN_COLOR, lw=2.0, label="—")

# Compare-all curves (P, PI, PD)
lines_cmp = {}
for key, sty in CMP_STYLES.items():
    ln, = ax.plot([], [], color=sty["color"], lw=1.8, label=sty["label"])
    ln.set_visible(False)
    lines_cmp[key] = ln

ax.legend(loc="lower right", fontsize=9)


# ── State ────────────────────────────────────────────────────────────────────
class State:
    P = True
    I = False
    D = False
    compare_all = False
    Kp = KP_DEFAULT
    Ki = KI_DEFAULT
    Kd = KD_DEFAULT
    v = W_SETPOINt
    t_max = T_MAX_DEFAULT
    # Saved gains: restored when a checkbox is re-ticked after unticking
    _saved_Kp = KP_DEFAULT
    _saved_Ki = KI_DEFAULT
    _saved_Kd = KD_DEFAULT
    _updating = False  # guard against slider ↔ textbox ↔ checkbox loops

state = State()


def current_controller_name():
    """Derive the controller type string from P/I/D checkbox state."""
    name = ""
    if state.P:
        name += "P"
    if state.I:
        name += "I"
    if state.D:
        name += "D"
    # A controller without P is not meaningful here
    return name if "P" in name else None


def gains_for_name(name):
    """Return (Kp, Ki, Kd) for a controller-type string like 'PI'.

    Uses the raw state values — inactive terms are zeroed by the checkbox
    logic, so this naturally respects the P/I/D toggles.
    """
    return (
        state.Kp,
        state.Ki if "I" in name else 0.0,
        state.Kd if "D" in name else 0.0,
    )


def _effective(gain_name, saved_attr, default):
    """Return the best available value for a gain: current > saved > default."""
    val = getattr(state, gain_name)
    if val > 0:
        return val
    val = getattr(state, saved_attr)
    if val > 0:
        return val
    return default


def gains_for_comparison(name):
    """Like gains_for_name but falls back to saved/default for zeroed gains.

    Used in compare-all mode so the curves stay meaningful even when a
    term has been unticked (and its gain zeroed).
    """
    Kp = _effective("Kp", "_saved_Kp", KP_DEFAULT)
    Ki = _effective("Ki", "_saved_Ki", KI_DEFAULT) if "I" in name else 0.0
    Kd = _effective("Kd", "_saved_Kd", KD_DEFAULT) if "D" in name else 0.0
    return Kp, Ki, Kd


def refresh_plot():
    """Re-run the relevant simulations and redraw."""
    y_max = state.v

    if state.compare_all:
        # Hide main curve, show P / PI / PD / PID
        line_main.set_data([], [])
        line_main.set_visible(False)
        for key in CMP_KEYS:
            Kp, Ki, Kd = gains_for_comparison(key)
            t, w = simulate(Kp, Ki, Kd, sp=state.v, t_max=state.t_max)
            lines_cmp[key].set_data(t, w)
            lines_cmp[key].set_visible(True)
            y_max = max(y_max, np.max(w))
    else:
        # Hide compare-all curves
        for ln in lines_cmp.values():
            ln.set_data([], [])
            ln.set_visible(False)
        # Show the single checkbox-driven curve
        name = current_controller_name()
        if name:
            Kp, Ki, Kd = gains_for_name(name)
            t, w = simulate(Kp, Ki, Kd, sp=state.v, t_max=state.t_max)
            line_main.set_data(t, w)
            line_main.set_visible(True)
            line_main.set_label(name)
            y_max = max(y_max, np.max(w))
        else:
            line_main.set_data([], [])
            line_main.set_visible(False)

    setpoint_line.set_ydata([state.v, state.v])
    ax.set_xlim(0, state.t_max)
    ax.set_ylim(-0.05 * max(state.v, 0.1),
                max(y_max * 1.15, state.v * 1.15))
    ax.legend(loc="lower right", fontsize=9)
    fig.canvas.draw_idle()


# ── Checkboxes: P / I / D ──────────────────────────────────────────────────
rax_ctrl = fig.add_axes([0.02, 0.72, 0.18, 0.16])
rax_ctrl.set_title("Controller terms", fontsize=10, fontweight="bold",
                   loc="left")
check_ctrl = CheckButtons(rax_ctrl, ["P", "I", "D"],
                          [state.P, state.I, state.D])
for lbl in check_ctrl.labels:
    lbl.set_fontsize(12)


_GAIN_FOR_LABEL = {"P": "Kp", "I": "Ki", "D": "Kd"}
_SAVED_FOR_LABEL = {"P": "_saved_Kp", "I": "_saved_Ki", "D": "_saved_Kd"}


def _set_checkbox(index, desired):
    """Programmatically set a CheckButtons entry without re-triggering our callback."""
    current = [state.P, state.I, state.D][index]
    if current != desired:
        state._updating = True
        check_ctrl.set_active(index)  # toggles the visual tick
        state._updating = False


def _sync_gain_to_ui(gain_name, val):
    """Push a gain value to its slider + textbox without triggering cascades."""
    prev = state._updating
    state._updating = True
    setattr(state, gain_name, val)
    sliders[gain_name].set_val(
        np.clip(val, sliders[gain_name].valmin, sliders[gain_name].valmax))
    text_boxes[gain_name].set_val(f"{val:g}")
    state._updating = prev


def on_ctrl_toggle(label):
    if state._updating:
        return
    if state.compare_all:
        return  # ignore while compare-all is active

    # Toggle the boolean
    new_val = not getattr(state, label)
    setattr(state, label, new_val)

    gain_name = _GAIN_FOR_LABEL[label]
    saved_attr = _SAVED_FOR_LABEL[label]

    if not new_val:
        # Unticked → save current gain, zero it
        setattr(state, saved_attr, getattr(state, gain_name))
        _sync_gain_to_ui(gain_name, 0.0)
    else:
        # Re-ticked → if user already set a non-zero value via slider,
        # keep it; otherwise restore saved (or default).
        current = getattr(state, gain_name)
        if current == 0.0:
            restored = getattr(state, saved_attr)
            if restored == 0.0:
                restored = {"Kp": KP_DEFAULT, "Ki": KI_DEFAULT,
                            "Kd": KD_DEFAULT}[gain_name]
            _sync_gain_to_ui(gain_name, restored)

    refresh_plot()

check_ctrl.on_clicked(on_ctrl_toggle)

# ── Checkbox: Compare all ───────────────────────────────────────────────────
rax_cmp = fig.add_axes([0.02, 0.64, 0.18, 0.06])
check_cmp = CheckButtons(rax_cmp, ["Compare all"], [False])
check_cmp.labels[0].set_fontsize(11)


def on_compare_toggle(_label):
    state.compare_all = not state.compare_all
    refresh_plot()

check_cmp.on_clicked(on_compare_toggle)


# ── Gain controls: textbox + slider for Kp, Ki, Kd ─────────────────────────
gain_specs = [
    # (name, y_base, default, slider_min, slider_max)
    ("Kp", 0.52, KP_DEFAULT,   0,  500),
    ("Ki", 0.40, KI_DEFAULT,   0, 1000),
    ("Kd", 0.28, KD_DEFAULT,   0,   50),
]

text_boxes = {}
sliders = {}

for name, yb, default, smin, smax in gain_specs:
    # Label
    lax = fig.add_axes([0.02, yb + 0.04, 0.06, 0.04])
    lax.axis("off")
    lax.text(0.9, 0.5, name, fontsize=11, fontweight="bold",
             ha="right", va="center", transform=lax.transAxes)
    # Text box (same row as label)
    tax = fig.add_axes([0.09, yb + 0.04, 0.11, 0.04])
    tb = TextBox(tax, "", initial=str(default))
    text_boxes[name] = tb
    # Slider (below the text box)
    sax = fig.add_axes([0.04, yb, 0.16, 0.025])
    sl = Slider(sax, "", smin, smax, valinit=default)
    sl.valtext.set_visible(False)  # we show the value in the textbox
    sliders[name] = sl


def _set_gain(name, val):
    """Write a gain value into state.  Checkboxes are NOT touched."""
    setattr(state, name, val)


def make_tb_callback(name):
    """Text-box on_submit: user presses Enter."""
    def cb(text):
        if state._updating:
            return
        try:
            val = float(text)
        except ValueError:
            return
        state._updating = True
        _set_gain(name, val)
        sliders[name].set_val(
            np.clip(val, sliders[name].valmin, sliders[name].valmax))
        state._updating = False
        refresh_plot()
    return cb


def make_sl_callback(name):
    """Slider on_changed: user drags slider."""
    def cb(val):
        if state._updating:
            return
        state._updating = True
        _set_gain(name, val)
        text_boxes[name].set_val(f"{val:.2f}")
        state._updating = False
        refresh_plot()
    return cb


for _name in ("Kp", "Ki", "Kd"):
    text_boxes[_name].on_submit(make_tb_callback(_name))
    sliders[_name].on_changed(make_sl_callback(_name))


# ── T_max control: textbox + slider ─────────────────────────────────────────
_tmax_yb = 0.16
_tmax_lax = fig.add_axes([0.02, _tmax_yb + 0.04, 0.06, 0.04])
_tmax_lax.axis("off")
_tmax_lax.text(0.9, 0.5, "T max", fontsize=10, fontweight="bold",
               ha="right", va="center", transform=_tmax_lax.transAxes)
_tmax_tax = fig.add_axes([0.09, _tmax_yb + 0.04, 0.11, 0.04])
tb_tmax = TextBox(_tmax_tax, "", initial=str(T_MAX_DEFAULT))
_tmax_sax = fig.add_axes([0.04, _tmax_yb, 0.16, 0.025])
sl_tmax = Slider(_tmax_sax, "", 0.5, 30.0, valinit=T_MAX_DEFAULT)
sl_tmax.valtext.set_visible(False)


def on_tmax_tb(text):
    if state._updating:
        return
    try:
        val = float(text)
        if val <= 0:
            return
    except ValueError:
        return
    state._updating = True
    state.t_max = val
    sl_tmax.set_val(np.clip(val, sl_tmax.valmin, sl_tmax.valmax))
    state._updating = False
    refresh_plot()


def on_tmax_sl(val):
    if state._updating:
        return
    state._updating = True
    state.t_max = val
    tb_tmax.set_val(f"{val:.1f}")
    state._updating = False
    refresh_plot()


tb_tmax.on_submit(on_tmax_tb)
sl_tmax.on_changed(on_tmax_sl)


# ── Reset button ─────────────────────────────────────────────────────────────
reset_ax = fig.add_axes([0.02, 0.91, 0.18, 0.045])
reset_btn = Button(reset_ax, "Reset defaults", hovercolor="0.85")


def on_reset(_event):
    state._updating = True
    state.Kp, state.Ki, state.Kd = KP_DEFAULT, KI_DEFAULT, KD_DEFAULT
    state._saved_Kp, state._saved_Ki, state._saved_Kd = (
        KP_DEFAULT, KI_DEFAULT, KD_DEFAULT)
    state.t_max = T_MAX_DEFAULT
    # Reset gain sliders + text fields — leave P/I/D checkboxes untouched
    for name, default in [("Kp", KP_DEFAULT), ("Ki", KI_DEFAULT),
                          ("Kd", KD_DEFAULT)]:
        sliders[name].set_val(default)
        text_boxes[name].set_val(str(default))
    sl_tmax.set_val(T_MAX_DEFAULT)
    tb_tmax.set_val(str(T_MAX_DEFAULT))
    state._updating = False
    refresh_plot()

reset_btn.on_clicked(on_reset)


# ── Cursor tracking: hover dot + coordinate readout ─────────────────────────
# Dot markers (initially empty / invisible)
dot_main, = ax.plot([], [], "o", color=MAIN_COLOR, ms=7, zorder=10)
dot_main.set_visible(False)

dots_cmp = {}
for key, sty in CMP_STYLES.items():
    d, = ax.plot([], [], "o", color=sty["color"], ms=7, zorder=10)
    d.set_visible(False)
    dots_cmp[key] = d

# Annotation box
cursor_annot = ax.annotate(
    "", xy=(0, 0), xytext=(15, 15), textcoords="offset points",
    fontsize=9, fontfamily="monospace",
    bbox=dict(boxstyle="round,pad=0.3", fc="lightyellow", alpha=0.92),
    zorder=11,
)
cursor_annot.set_visible(False)


def _nearest_y(line, x):
    """Return y on *line* at the closest sampled x."""
    xd, yd = line.get_data()
    if len(xd) == 0:
        return None
    idx = int(np.clip(np.searchsorted(xd, x), 0, len(xd) - 1))
    return float(yd[idx])


def on_mouse_move(event):
    # Hide everything if the mouse is outside the axes
    if event.inaxes != ax:
        dot_main.set_visible(False)
        for d in dots_cmp.values():
            d.set_visible(False)
        cursor_annot.set_visible(False)
        fig.canvas.draw_idle()
        return

    x = event.xdata
    lines_text = []
    ann_y = None  # y for the annotation anchor

    if state.compare_all:
        dot_main.set_visible(False)
        for key in CMP_KEYS:
            y = _nearest_y(lines_cmp[key], x)
            if y is None:
                dots_cmp[key].set_visible(False)
                continue
            dots_cmp[key].set_data([x], [y])
            dots_cmp[key].set_visible(True)
            lines_text.append(f"{key:3s}: ω = {y:.4f}")
            if ann_y is None or y > ann_y:
                ann_y = y
    else:
        for d in dots_cmp.values():
            d.set_visible(False)
        y = _nearest_y(line_main, x)
        if y is None:
            dot_main.set_visible(False)
            cursor_annot.set_visible(False)
            fig.canvas.draw_idle()
            return
        dot_main.set_data([x], [y])
        dot_main.set_visible(True)
        name = current_controller_name() or "?"
        lines_text.append(f"{name}: ω = {y:.4f}")
        ann_y = y

    if ann_y is None:
        cursor_annot.set_visible(False)
    else:
        text = f"t = {x:.3f} s\n" + "\n".join(lines_text)
        cursor_annot.set_text(text)
        cursor_annot.xy = (x, ann_y)
        cursor_annot.set_visible(True)

    fig.canvas.draw_idle()


fig.canvas.mpl_connect("motion_notify_event", on_mouse_move)

# ── Initial draw ─────────────────────────────────────────────────────────────
refresh_plot()
plt.show()
