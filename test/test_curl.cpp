// Desktop test for CurlTracker.h using simulated forearm motion.
// Build: g++ -O2 -std=c++17 test/test_curl.cpp -o test_curl && ./test_curl
//
// Physics: the strap sits r metres from the elbow. The forearm rotates by
// theta(t) in a vertical plane (0 = hanging down). The accelerometer reads
// (motion acceleration - gravity) in g, expressed in the strap's own frame,
// which is mounted at an arbitrary orientation and twists with the wrist.

#define _USE_MATH_DEFINES
#include <cmath>
#include <cstdio>
#include <random>
#include <string>
#include <vector>
#include "../curl_strap/CurlTracker.h"

using curl::Vec3;

struct M3 { double m[3][3]; };
static M3 mul(const M3& a, const M3& b) {
  M3 r{};
  for (int i = 0; i < 3; ++i)
    for (int j = 0; j < 3; ++j)
      for (int k = 0; k < 3; ++k) r.m[i][j] += a.m[i][k] * b.m[k][j];
  return r;
}
static M3 rotX(double a) { return {{{1, 0, 0}, {0, cos(a), -sin(a)}, {0, sin(a), cos(a)}}}; }
static M3 rotY(double a) { return {{{cos(a), 0, sin(a)}, {0, 1, 0}, {-sin(a), 0, cos(a)}}}; }
static M3 rotZ(double a) { return {{{cos(a), -sin(a), 0}, {sin(a), cos(a), 0}, {0, 0, 1}}}; }
static void apply(const M3& R, const double v[3], double out[3]) {  // out = R^T v
  for (int i = 0; i < 3; ++i) out[i] = R.m[0][i] * v[0] + R.m[1][i] * v[1] + R.m[2][i] * v[2];
}

// One phase of a movement: go from angle a0 to a1 (deg) over dur seconds,
// with smooth (cosine) easing. dur with a0 == a1 is a hold.
struct Phase { double a0, a1, dur; };

struct Sim {
  double r = 0.10;          // strap distance from elbow (m): upper forearm
  double noiseG = 0.02;     // sensor noise (g)
  double twistDeg = 70;     // wrist supination during the curl (deg)
  M3 mount = mul(rotX(0.6), mul(rotY(-1.1), rotZ(2.3)));  // arbitrary strap mounting
  std::mt19937 rng{42};

  double gyroNoise = 0.005;  // rad/s
  double gyroBias = 0.01;    // rad/s left over after bias removal (~0.6 deg/s)

  std::vector<Vec3> samples;
  std::vector<Vec3> gyros;
  std::vector<double> times;
  double t = 0;

  double thetaAt(const std::vector<Phase>& ph, double tt) {
    double acc = 0;
    for (auto& p : ph) {
      if (tt <= acc + p.dur) {
        double u = (tt - acc) / p.dur;
        double e = 0.5 - 0.5 * cos(M_PI * u);
        return (p.a0 + (p.a1 - p.a0) * e) * M_PI / 180.0;
      }
      acc += p.dur;
    }
    return ph.back().a1 * M_PI / 180.0;
  }

  void run(const std::vector<Phase>& ph) {
    double total = 0;
    for (auto& p : ph) total += p.dur;
    std::normal_distribution<double> n(0, noiseG);
    const double dt = 0.01, h = 0.001;
    for (double tt = 0; tt < total; tt += dt) {
      // position of the strap in world frame (z up): p = r*(sin th, 0, -cos th)
      auto pos = [&](double x, double c[3]) {
        double a = thetaAt(ph, x);
        c[0] = r * sin(a); c[1] = 0; c[2] = -r * cos(a);
      };
      double pm[3], p0[3], pp[3];
      pos(std::max(0.0, tt - h), pm); pos(tt, p0); pos(tt + h, pp);
      double acc[3];
      for (int i = 0; i < 3; ++i) acc[i] = (pp[i] - 2 * p0[i] + pm[i]) / (h * h) / 9.81;
      double f[3] = {acc[0], acc[1], acc[2] + 1.0};  // specific force, in g
      // forearm frame rotates with theta about world y; then wrist twist about
      // the forearm axis (z of forearm frame), then fixed strap mounting.
      auto orient = [&](double x) {
        double a = thetaAt(ph, x);
        double twist = (a / (140 * M_PI / 180.0)) * twistDeg * M_PI / 180.0;
        return mul(mul(rotY(-a), rotZ(twist)), mount);  // strap frame -> world
      };
      M3 R = orient(tt);
      double s[3];
      apply(R, f, s);
      samples.push_back({float(s[0] + n(rng)), float(s[1] + n(rng)), float(s[2] + n(rng))});
      // Gyro: body angular velocity from W = R^T dR/dt (skew-symmetric).
      M3 Rp = orient(tt + h), Rm = orient(std::max(0.0, tt - h));
      double dtR = (tt - h < 0) ? h : 2 * h;
      M3 dR{};
      for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) dR.m[i][j] = (Rp.m[i][j] - Rm.m[i][j]) / dtR;
      M3 Rt{};
      for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) Rt.m[i][j] = R.m[j][i];
      M3 W = mul(Rt, dR);
      std::normal_distribution<double> gn(0, gyroNoise);
      gyros.push_back({float(W.m[2][1] + gyroBias + gn(rng)), float(W.m[0][2] - gyroBias + gn(rng)),
                       float(W.m[1][0] + gyroBias + gn(rng))});
      times.push_back(t + tt);
    }
    t += total;
  }
};

static int failures = 0;
static bool g_useGyro = true;

static void check(bool ok, const char* what) {
  printf("  [%s] %s\n", ok ? "PASS" : "FAIL", what);
  if (!ok) ++failures;
}

struct Outcome { std::vector<curl::RepResult> reps; };

static Outcome runScenario(Sim& sim, curl::Tracker& tr, bool begin = true) {
  // Rest reading = first sample (arm hanging still).
  if (begin) tr.beginSet(sim.samples.front());
  Outcome o;
  curl::RepResult r;
  for (size_t i = 0; i < sim.samples.size(); ++i) {
    bool done = g_useGyro ? tr.update(sim.samples[i], sim.gyros[i], (float)sim.times[i], r)
                          : tr.update(sim.samples[i], (float)sim.times[i], r);
    if (done) o.reps.push_back(r);
  }
  for (auto& x : o.reps)
    printf("    rep %u good=%d ref=%d peak=%.1f lift=%.2f lower=%.2f swing=%.2f -> %s\n",
           x.number, x.good, x.isReference, x.peakDeg, x.liftSec, x.lowerSec, x.swingG,
           curl::Tracker::faultText(x.faults));
  return o;
}

static std::vector<Phase> curlRep(double peak, double up, double hold, double down, double rest = 1.0) {
  return {{0, peak, up}, {peak, peak, hold}, {peak, 0, down}, {0, 0, rest}};
}

static std::vector<Phase> concat(std::initializer_list<std::vector<Phase>> parts) {
  std::vector<Phase> out;
  for (auto& p : parts) out.insert(out.end(), p.begin(), p.end());
  return out;
}

int main(int argc, char** argv) {
  // Default: accelerometer + gyroscope (BMX160). Pass --accel-only to test
  // the accelerometer-only path.
  if (argc > 1 && std::string(argv[1]) == "--accel-only") g_useGyro = false;
  printf("Mode: %s\n\n", g_useGyro ? "accelerometer + gyroscope" : "accelerometer only");
  std::vector<Phase> rest = {{0, 0, 1.0}};

  printf("1) Five slow, full curls -> 5 good reps\n");
  {
    Sim sim; curl::Tracker tr;
    auto rep = curlRep(135, 1.2, 0.3, 2.0);
    sim.run(concat({rest, rep, rep, rep, rep, rep}));
    auto o = runScenario(sim, tr);
    int good = 0; for (auto& r : o.reps) good += r.good;
    check(o.reps.size() == 5, "counted 5 reps");
    check(good == 5, "all 5 good");
    check(fabs(o.reps[0].peakDeg - 135) < 5, "peak angle within 5 deg of true 135");
  }

  printf("2) Half rep (only to 80 deg) -> 'Curl higher'\n");
  {
    Sim sim; curl::Tracker tr;
    sim.run(concat({rest, curlRep(80, 1.0, 0.2, 1.5)}));
    auto o = runScenario(sim, tr);
    check(o.reps.size() == 1 && (o.reps[0].faults & curl::FAULT_SHORT_RANGE), "flagged short range");
  }

  printf("3) Dropping the weight (lower in 0.4 s) -> 'Lower slower'\n");
  {
    Sim sim; curl::Tracker tr;
    sim.run(concat({rest, curlRep(135, 1.2, 0.2, 0.4)}));
    auto o = runScenario(sim, tr);
    check(o.reps.size() == 1 && (o.reps[0].faults & curl::FAULT_LOWER_FAST), "flagged fast lowering");
  }

  printf("4) Holding at the top 2 s then dropping -> still 'Lower slower'\n");
  {
    Sim sim; curl::Tracker tr;
    sim.run(concat({rest, curlRep(135, 1.2, 2.0, 0.4)}));
    auto o = runScenario(sim, tr);
    check(o.reps.size() == 1 && (o.reps[0].faults & curl::FAULT_LOWER_FAST), "hold at top not counted as lowering");
  }

  printf("5) Swinging it up fast (0.3 s) -> lift too fast / swinging\n");
  {
    Sim sim; curl::Tracker tr;
    sim.run(concat({rest, curlRep(140, 0.3, 0.1, 1.5)}));
    auto o = runScenario(sim, tr);
    check(o.reps.size() == 1 && !o.reps[0].good, "fast rep is not good");
    check(o.reps.size() == 1 && (o.reps[0].faults & curl::FAULT_SWING), "swing detected from extra acceleration");
  }

  printf("6) Small fidgets (25 and 40 deg) -> no reps counted\n");
  {
    Sim sim; curl::Tracker tr;
    sim.run(concat({rest, curlRep(25, 0.5, 0, 0.5), curlRep(40, 0.6, 0, 0.6)}));
    auto o = runScenario(sim, tr);
    check(o.reps.empty(), "no reps from fidgeting");
  }

  printf("7) Reference rep for a patient with limited range (95 deg)\n");
  {
    Sim sim; curl::Tracker tr;
    auto refRep = curlRep(95, 1.5, 0.3, 2.5);
    sim.run(concat({rest, refRep}));
    tr.beginSet(sim.samples.front());
    tr.teachNextRep();
    auto o = runScenario(sim, tr, false);
    check(o.reps.size() == 1 && o.reps[0].isReference, "reference recorded");
    printf("    new targets: peak>=%.1f lift>=%.2f lower>=%.2f\n", tr.s.targetPeak, tr.s.minLiftSec, tr.s.minLowerSec);

    Sim sim2; // same patient, next set
    sim2.run(concat({rest, curlRep(92, 1.4, 0.3, 2.2), curlRep(60, 1.0, 0.2, 1.5)}));
    curl::Tracker tr2; tr2.s = tr.s;
    auto o2 = runScenario(sim2, tr2);
    check(o2.reps.size() == 2 && o2.reps[0].good, "92 deg rep is good for this patient");
    check(o2.reps.size() == 2 && !o2.reps[1].good, "60 deg rep is still too short");
  }

  printf("8) Very long slow rep (12 s up, 12 s down) -> buffer compaction works\n");
  {
    Sim sim; curl::Tracker tr; tr.s.timeoutSec = 60;
    sim.run(concat({rest, curlRep(130, 12, 1, 12)}));
    auto o = runScenario(sim, tr);
    check(o.reps.size() == 1 && o.reps[0].good, "one good rep");
    check(o.reps.size() == 1 && o.reps[0].lowerSec > 5, "lower time measured over the long descent");
  }

  printf("9) Strap worn near the wrist (22 cm from elbow) instead of near the elbow\n");
  {
    Sim sim; sim.r = 0.22; curl::Tracker tr;
    auto rep = curlRep(135, 1.2, 0.3, 2.0);
    sim.run(concat({rest, rep, rep, rep}));
    auto o = runScenario(sim, tr);
    int good = 0; for (auto& r : o.reps) good += r.good;
    check(o.reps.size() == 3 && good == 3, "still counts 3 good reps");
    check(o.reps.size() == 3 && fabs(o.reps[0].peakDeg - 135) < 8, "peak within 8 deg (less accurate than near elbow)");
  }

  printf("10) Fast drop with the strap near the wrist -> no double count\n");
  {
    Sim sim; sim.r = 0.22; curl::Tracker tr;
    sim.run(concat({rest, curlRep(135, 1.2, 0.2, 0.4)}));
    auto o = runScenario(sim, tr);
    check(o.reps.size() == 1, "counted once");
  }

  printf("\n%s (%d failure%s)\n", failures ? "SOME TESTS FAILED" : "ALL TESTS PASSED", failures,
         failures == 1 ? "" : "s");
  return failures ? 1 : 0;
}
