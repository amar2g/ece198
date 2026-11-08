// CurlTracker.h - bicep curl rep counting and scoring from one motion sensor
// (accelerometer + gyroscope such as the BMX160, or accelerometer only).
//
// Pure C++ (no Arduino calls) so the same logic runs on the board and in the
// desktop test (test/test_curl.cpp).
//
// How it works
// ------------
// The strap sits on the forearm. When the arm hangs straight down and still,
// we store the direction gravity points in the sensor's frame ("reference").
// During the set, the forearm angle is the angle between the current gravity
// direction and that reference:  0 deg = arm hanging, ~140 deg = full curl.
// Because we compare against a reference captured on the patient, it does not
// matter which way the strap is mounted, and twisting the wrist (supination)
// does not change the reading. With a gyroscope the gravity direction is
// tracked through fast movements too (complementary filter); without one it
// comes from the accelerometer alone.
//
// A rep = angle rises past startAngle, reaches a peak, and falls back below
// endAngle. Each rep is then scored on:
//   - range:   peak angle >= targetPeak
//   - lift:    time from bottom to top >= minLiftSec      (not jerked up)
//   - lower:   time from top to bottom >= minLowerSec     (not dropped)
//   - swing:   extra acceleration beyond gravity <= maxSwingG (no momentum)
// teachNextRep() makes the next rep the patient's personal reference and
// derives their targets from it.

#pragma once
#include <math.h>
#include <stdint.h>

namespace curl {

struct Vec3 {
  float x, y, z;
};

inline float vlen(const Vec3& v) { return sqrtf(v.x * v.x + v.y * v.y + v.z * v.z); }

enum Fault : uint8_t {
  FAULT_NONE = 0,
  FAULT_SHORT_RANGE = 1 << 0,  // did not curl high enough
  FAULT_LIFT_FAST = 1 << 1,    // jerked the weight up
  FAULT_LOWER_FAST = 1 << 2,   // dropped the weight instead of lowering it
  FAULT_SWING = 1 << 3,        // lots of extra acceleration = using momentum
};

struct Settings {
  float startAngle = 30.0f;   // deg: rep starts when forearm rises past this
  float endAngle = 20.0f;     // deg: rep ends when forearm returns below this
  float minMotion = 45.0f;    // deg: peaks below this are ignored (fidgeting)
  float topBand = 10.0f;      // deg: "at the top" = within this of the peak
  float targetPeak = 110.0f;  // deg: must reach this for full range
  float minLiftSec = 0.5f;    // s
  float minLowerSec = 1.0f;   // s
  float maxSwingG = 0.35f;    // g
  float timeoutSec = 20.0f;   // abandon a "rep" that lasts longer than this
  float filterAlpha = 0.25f;  // accel-only mode: smoothing for the angle (~100 Hz)
  float accelGain = 0.02f;    // gyro mode: how fast the accel corrects gyro drift
  float swingAlpha = 0.5f;    // light smoothing for the swing measure
  float gateG = 0.3f;         // ignore angle updates when accel is off 1 g by this much
};

struct RepResult {
  uint16_t number;   // rep number in this set (1-based); 0 for a reference rep
  bool good;
  bool isReference;  // this rep was recorded as the patient's reference
  uint8_t faults;    // Fault bit flags
  float peakDeg;
  float liftSec;
  float lowerSec;
  float swingG;
};

class Tracker {
 public:
  Settings s;

  // Call with an averaged reading taken while the arm hangs straight and still.
  void beginSet(const Vec3& restAccelG) {
    float n = vlen(restAccelG);
    if (n < 1e-6f) n = 1.0f;
    ref_ = {restAccelG.x / n, restAccelG.y / n, restAccelG.z / n};
    filt_ = ref_;
    magFilt_ = n;
    angle_ = 0.0f;
    state_ = IDLE;
    tLastBottom_ = -1.0f;
    lastT_ = -1.0f;
    reps_ = 0;
    goodReps_ = 0;
  }

  // Feed one sample with its time in seconds. Returns true when a rep has just
  // finished; details are written to `out`.
  //   a     accelerometer, in g
  //   gyro  gyroscope, in rad/s, with its at-rest bias already subtracted
  bool update(const Vec3& a, const Vec3& gyro, float t, RepResult& out) {
    return step(a, &gyro, t, out);
  }
  // Accelerometer-only version (for sensors without a gyroscope).
  bool update(const Vec3& a, float t, RepResult& out) { return step(a, nullptr, t, out); }

 private:
  bool step(const Vec3& a, const Vec3* gyro, float t, RepResult& out) {
    // The accelerometer feels gravity plus the arm's own acceleration. Only
    // gravity tells us the angle, so trust a sample less the further its size
    // is from 1 g (i.e. the harder the arm is accelerating).
    float mag = vlen(a);
    float trust = 1.0f - fabsf(mag - 1.0f) / s.gateG;
    if (trust < 0.0f) trust = 0.0f;
    magFilt_ += s.swingAlpha * (mag - magFilt_);

    if (gyro) {
      // Complementary filter. filt_ is the gravity direction in the sensor's
      // frame. The gyro says how the sensor turned since the last sample, so
      // turn gravity the opposite way: dg/dt = -(w x g). This is accurate
      // during fast movement but drifts slowly, so nudge it toward the
      // accelerometer's direction when the arm isn't accelerating much.
      float dt = (lastT_ < 0.0f) ? 0.0f : t - lastT_;
      if (dt > 0.1f) dt = 0.1f;
      const Vec3& w = *gyro;
      Vec3 g = filt_;
      filt_.x = g.x - (w.y * g.z - w.z * g.y) * dt;
      filt_.y = g.y - (w.z * g.x - w.x * g.z) * dt;
      filt_.z = g.z - (w.x * g.y - w.y * g.x) * dt;
      if (mag > 1e-6f) {
        float k = s.accelGain * trust;
        filt_.x += k * (a.x / mag - filt_.x);
        filt_.y += k * (a.y / mag - filt_.y);
        filt_.z += k * (a.z / mag - filt_.z);
      }
      float n = vlen(filt_);
      if (n > 1e-6f) filt_ = {filt_.x / n, filt_.y / n, filt_.z / n};
    } else {
      float k = s.filterAlpha * trust;
      filt_.x += k * (a.x - filt_.x);
      filt_.y += k * (a.y - filt_.y);
      filt_.z += k * (a.z - filt_.z);
    }
    lastT_ = t;

    float n = vlen(filt_);
    if (n > 1e-6f) {
      float c = (filt_.x * ref_.x + filt_.y * ref_.y + filt_.z * ref_.z) / n;
      if (c > 1.0f) c = 1.0f;
      if (c < -1.0f) c = -1.0f;
      angle_ = acosf(c) * 57.29578f;
    }
    if (tLastBottom_ < 0.0f) tLastBottom_ = t;

    // Peak swing over roughly the last half second. A fast swing freezes the
    // angle (see trust above), so the rep may only "start" after the burst.
    float sw = fabsf(magFilt_ - 1.0f);
    if (sw >= recentSwing_ || t - recentSwingT_ > 0.5f) {
      recentSwing_ = sw;
      recentSwingT_ = t;
    }

    if (state_ == IDLE) {
      if (angle_ <= s.endAngle) tLastBottom_ = t;
      if (angle_ > s.startAngle) {
        state_ = MOVING;
        peak_ = angle_;
        swing_ = recentSwing_;
        clearBuffer();
        record(tLastBottom_, s.endAngle);
        record(t, angle_);
      }
      return false;
    }

    // state_ == MOVING
    record(t, angle_);
    if (angle_ > peak_) peak_ = angle_;
    if (sw > swing_) swing_ = sw;

    if (t - tLastBottom_ > s.timeoutSec) {  // e.g. arm rested on a table
      state_ = IDLE;
      tLastBottom_ = t;
      return false;
    }
    if (angle_ >= s.endAngle) return false;

    // Back at the bottom: the movement is over.
    state_ = IDLE;
    float tStart = tLastBottom_;
    tLastBottom_ = t;
    if (peak_ < s.minMotion) return false;  // too small to be a rep

    float topThresh = peak_ - s.topBand;
    float tReachTop = t, tLeaveTop = tStart;
    bool found = false;
    for (uint16_t i = 0; i < count_; ++i) {
      if (bufA_[i] >= topThresh) {
        if (!found) tReachTop = bufT_[i];
        tLeaveTop = bufT_[i];
        found = true;
      }
    }

    out.peakDeg = peak_;
    out.liftSec = tReachTop - tStart;
    out.lowerSec = t - tLeaveTop;
    out.swingG = swing_;

    if (teachPending_) {
      teachPending_ = false;
      hasReference_ = true;
      s.targetPeak = fmaxf(s.minMotion + 10.0f, peak_ - 15.0f);
      s.minLiftSec = fmaxf(0.3f, out.liftSec * 0.5f);
      s.minLowerSec = fmaxf(0.5f, out.lowerSec * 0.6f);
      out.number = 0;
      out.isReference = true;
      out.faults = FAULT_NONE;
      out.good = true;
      return true;
    }

    uint8_t f = FAULT_NONE;
    if (out.peakDeg < s.targetPeak) f |= FAULT_SHORT_RANGE;
    if (out.liftSec < s.minLiftSec) f |= FAULT_LIFT_FAST;
    if (out.lowerSec < s.minLowerSec) f |= FAULT_LOWER_FAST;
    if (out.swingG > s.maxSwingG) f |= FAULT_SWING;

    out.faults = f;
    out.good = (f == FAULT_NONE);
    out.isReference = false;
    out.number = ++reps_;
    if (out.good) ++goodReps_;
    return true;
  }

 public:
  void teachNextRep() { teachPending_ = true; }
  bool teachPending() const { return teachPending_; }
  bool hasReference() const { return hasReference_; }
  float angle() const { return angle_; }
  bool inRep() const { return state_ == MOVING; }
  uint16_t reps() const { return reps_; }
  uint16_t goodReps() const { return goodReps_; }

  // Short feedback for the most important fault (fits the OLED).
  static const char* faultText(uint8_t f) {
    if (f & FAULT_SHORT_RANGE) return "Curl higher";
    if (f & FAULT_LOWER_FAST) return "Lower slower";
    if (f & FAULT_SWING) return "Don't swing";
    if (f & FAULT_LIFT_FAST) return "Lift slower";
    return "Good rep";
  }

 private:
  enum State : uint8_t { IDLE, MOVING };

  // Angle history for the current rep. When full, every other sample is
  // dropped and recording slows down, so a rep of any length fits.
  static const uint16_t kBuf = 512;
  float bufT_[kBuf];
  float bufA_[kBuf];
  uint16_t count_ = 0;
  uint16_t stride_ = 1;
  uint16_t skip_ = 0;

  void clearBuffer() {
    count_ = 0;
    stride_ = 1;
    skip_ = 0;
  }
  void record(float t, float a) {
    if (skip_ > 0) {
      --skip_;
      return;
    }
    skip_ = stride_ - 1;
    if (count_ == kBuf) {
      for (uint16_t i = 0; i < kBuf / 2; ++i) {
        bufT_[i] = bufT_[2 * i];
        bufA_[i] = bufA_[2 * i];
      }
      count_ = kBuf / 2;
      stride_ *= 2;
      skip_ = stride_ - 1;
    }
    bufT_[count_] = t;
    bufA_[count_] = a;
    ++count_;
  }

  Vec3 ref_ = {0, 0, 1};
  Vec3 filt_ = {0, 0, 1};
  float magFilt_ = 1.0f;
  float angle_ = 0.0f;
  State state_ = IDLE;
  float tLastBottom_ = -1.0f;
  float lastT_ = -1.0f;
  float peak_ = 0.0f;
  float swing_ = 0.0f;
  float recentSwing_ = 0.0f;
  float recentSwingT_ = 0.0f;
  uint16_t reps_ = 0;
  uint16_t goodReps_ = 0;
  bool teachPending_ = false;
  bool hasReference_ = false;
};

}  // namespace curl
