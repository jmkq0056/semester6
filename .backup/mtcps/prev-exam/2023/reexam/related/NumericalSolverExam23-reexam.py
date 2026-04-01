#!/bin/python3

import matplotlib.pyplot as plt
import math

def f(x, t):
    # Implements the simplified pendulum model
    m = 2
    g = 9.81
    l = 1.5

    ...

    # You should return an array of state derivatives
    return [...]


def main():
    x0 = [0, 0]  # Initial state
    t0 = 0  # Initial time
    T = 10  # Time horizon

    fig, ax = plt.subplots()
    experiment(x0, t0, 0.01, T, ax)

    ax.set_xlabel("t")
    ax.legend()
    plt.show()


# -------------------------------------------------------
# Code below does not need to be changed during the exam.
def runge_kutta_4(f, x0, t0, h, N):
    t = [t0]
    result = [x0]
    for i in range(N):
        xi = result[-1]

        k1 = f(xi, t[-1])
        k2 = f(extend(xi, h/2, k1), t[-1] + h/2)
        k3 = f(extend(xi, h/2, k2), t[-1] + h/2)
        k4 = f(extend(xi, h, k3), t[-1] + h)
        step = []
        for j in range(len(xi)):
            step.append(xi[j] + h/6 * (k1[j] + 2*k2[j] + 2*k3[j] + k4[j]))
        result.append(step)
        t.append(t[-1] + h)
    return t, result


def extend(x, h, der):
    assert(len(x)) == len(der)
    result = []
    for j in range(len(x)):
        result.append(x[j] + h * der[j])
    return result


def convert(data):
    result = []
    for i in range(len(data[0])):
        result.append([])

    for x in data:
        for i in range(len(x)):
            result[i].append(x[i])
    return result


def experiment(x0, t0, h, T, ax):
    N = round(T / h)
    t, result = runge_kutta_4(f, x0, t0, h, N)
    result = convert(result)
    for i in range(len(result)):
        if i == 0:  # Only plot state 0, which is the height.
            ax.plot(t, result[i], label=f's[{i}](t)')


if __name__ == '__main__':
    main()
