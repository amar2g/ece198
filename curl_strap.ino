// curl_strap.ino - forearm strap that counts bicep curls and checks each rep.
//
// Hardware: Arduino UNO R4 (Minima or WiFi) + BMX160 motion sensor over I2C.
// You control it by typing letters in the Serial Monitor (115200 baud):
//   s  start a set   (let the arm hang straight down and still first)
//   r  make the NEXT rep this patient's reference rep
//   e  end the set and print a summary
//   p  turn the live angle graph (Serial Plotter) on/off
//   i  show the current targets
//   h  show this help
// The board's built-in LED (marked "L") lights for 1 s after a good rep and
// blinks 3 times after a rep that needs fixing.
//
// See README.md for wiring and step-by-step instructions.

#include <Wire.h>
#include "CurlTracker.h"

// ---------- options ----------
// UNO R4 WiFi only: to plug the sensor into the small Qwiic connector instead
// of the SDA/SCL header pins, change Wire to Wire1.
#define SENSOR_WIRE Wire

const uint32_t SAMPLE_MS = 10;  // 100 samples per second
const int STATUS_LED = LED_BUILTIN;

// ---------- BMX160 registers (same map as the Bosch BMI160 for accel/gyro) ----------
const uint8_t REG_CHIP_ID = 0x00;   // reads 0xD8 on a BMX160
const uint8_t REG_PMU_STATUS = 0x03;
const uint8_t REG_GYRO_DATA = 0x0C; // 6 bytes gyro X,Y,Z then 6 bytes accel X,Y,Z
const uint8_t REG_ACC_CONF = 0x40;
const uint8_t REG_ACC_RANGE = 0x41;
const uint8_t REG_GYR_CONF = 0x42;
const uint8_t REG_GYR_RANGE = 0x43;
const uint8_t REG_CMD = 0x7E;

const float ACC_LSB_PER_G = 8192.0f;    // +/-4 g range
const float GYR_LSB_PER_DPS = 32.8f;    // +/-1000 deg/s range
const float DEG_TO_RAD_F = 0.01745329f;

uint8_t sensorAddr = 0;  // found at start-up: 0x68 or 0x69

curl::Tracker tracker;

// ---------- state ----------
enum Mode { MODE_IDLE, MODE_ZEROING, MODE_SET };
Mode mode = MODE_IDLE;
bool plotMode = false;
uint32_t lastSample = 0;
bool sensorErrorShown = false;

// zeroing: average 50 still samples (0.5 s) of accel, and of gyro to get its bias
const int ZERO_SAMPLES = 50;
int zeroCount = 0;
curl::Vec3 zeroAcc = {0, 0, 0}, zeroGyr = {0, 0, 0};
curl::Vec3 gyroBias = {0, 0, 0};
uint32_t zeroStartedAt = 0, lastStillWarning = 0;

// LED feedback
int ledToggles = 0;
uint32_t ledNextAt = 0;

// ---------- I2C helpers ----------
bool writeReg(uint8_t reg, uint8_t val) {
  SENSOR_WIRE.beginTransmission(sensorAddr);
  SENSOR_WIRE.write(reg);
  SENSOR_WIRE.write(val);
  return SENSOR_WIRE.endTransmission() == 0;
}

bool readRegs(uint8_t addr, uint8_t reg, uint8_t* buf, uint8_t n) {
  SENSOR_WIRE.beginTransmission(addr);
  SENSOR_WIRE.write(reg);
  if (SENSOR_WIRE.endTransmission(false) != 0) return false;
  if (SENSOR_WIRE.requestFrom(addr, n) != n) return false;
  for (uint8_t i = 0; i < n; ++i) buf[i] = SENSOR_WIRE.read();
  return true;
}

void scanBus() {
  Serial.println("  Devices answering on the I2C bus:");
  int found = 0;
  for (uint8_t a = 1; a < 127; ++a) {
    SENSOR_WIRE.beginTransmission(a);
    if (SENSOR_WIRE.endTransmission() == 0) {
      Serial.print("    0x");
      Serial.println(a, HEX);
      ++found;
    }
  }
  if (!found) Serial.println("    (none - check the 4 wires and the power pin)");
}

bool setupSensor() {
  // The address-select switch/pad on the board picks 0x68 or 0x69. Try both.
  const uint8_t candidates[2] = {0x68, 0x69};
  for (uint8_t i = 0; i < 2; ++i) {
    uint8_t id = 0;
    if (readRegs(candidates[i], REG_CHIP_ID, &id, 1) && (id == 0xD8 || id == 0xD1)) {
      sensorAddr = candidates[i];
      break;
    }
  }
  if (!sensorAddr) return false;

  writeReg(REG_CMD, 0xB6);  // soft reset
  delay(50);
  writeReg(REG_CMD, 0x11);  // accelerometer: normal mode
  delay(50);
  writeReg(REG_CMD, 0x15);  // gyroscope: normal mode
  delay(100);
  writeReg(REG_ACC_CONF, 0x28);   // 100 Hz, normal filtering
  writeReg(REG_ACC_RANGE, 0x05);  // +/-4 g
  writeReg(REG_GYR_CONF, 0x28);   // 100 Hz, normal filtering
  writeReg(REG_GYR_RANGE, 0x01);  // +/-1000 deg/s
  delay(20);

  uint8_t pmu = 0;
  readRegs(sensorAddr, REG_PMU_STATUS, &pmu, 1);
  bool accOn = ((pmu >> 4) & 0x03) == 1;
  bool gyrOn = ((pmu >> 2) & 0x03) == 1;
  if (!accOn || !gyrOn) {
    Serial.print("  Warning: sensor power status is 0x");
    Serial.print(pmu, HEX);
    Serial.println(" (accel or gyro did not switch on)");
  }
  return true;
}

// Reads accel (g) and gyro (rad/s, bias NOT removed). Returns false on I2C error.
bool readSensor(curl::Vec3& acc, curl::Vec3& gyr) {
  uint8_t b[12];
  if (!readRegs(sensorAddr, REG_GYRO_DATA, b, 12)) return false;
  int16_t v[6];
  for (int i = 0; i < 6; ++i) v[i] = (int16_t)(b[2 * i] | (b[2 * i + 1] << 8));
  const float gk = DEG_TO_RAD_F / GYR_LSB_PER_DPS;
  gyr = {v[0] * gk, v[1] * gk, v[2] * gk};
  acc = {v[3] / ACC_LSB_PER_G, v[4] / ACC_LSB_PER_G, v[5] / ACC_LSB_PER_G};
  return true;
}

// ---------- LED ----------
void ledGood() {  // solid for 1 s
  digitalWrite(STATUS_LED, HIGH);
  ledToggles = 1;
  ledNextAt = millis() + 1000;
}
void ledBad() {  // 3 quick blinks
  digitalWrite(STATUS_LED, HIGH);
  ledToggles = 5;
  ledNextAt = millis() + 150;
}
void updateLed() {
  if (ledToggles > 0 && (int32_t)(millis() - ledNextAt) >= 0) {
    digitalWrite(STATUS_LED, !digitalRead(STATUS_LED));
    --ledToggles;
    ledNextAt = millis() + 150;
    if (ledToggles == 0) digitalWrite(STATUS_LED, LOW);
  }
}

// ---------- messages ----------
void printHelp() {
  Serial.println();
  Serial.println("Commands (type a letter, then press Enter):");
  Serial.println("  s = start a set (let the arm hang straight down and still)");
  Serial.println("  r = record the NEXT rep as this patient's reference rep");
  Serial.println("  e = end the set");
  Serial.println("  p = live angle graph on/off (open Tools > Serial Plotter)");
  Serial.println("  i = show current targets");
  Serial.println("  h = show this help");
  Serial.println();
}

void printTargets() {
  Serial.print("Targets: curl to at least ");
  Serial.print(tracker.s.targetPeak, 0);
  Serial.print(" deg, lift for at least ");
  Serial.print(tracker.s.minLiftSec, 2);
  Serial.print(" s, lower for at least ");
  Serial.print(tracker.s.minLowerSec, 2);
  Serial.print(" s, swing under ");
  Serial.print(tracker.s.maxSwingG, 2);
  Serial.println(" g");
  Serial.println(tracker.hasReference() ? "(set from this patient's reference rep)"
                                        : "(default targets - no reference rep yet)");
}

void printRepDetails(const curl::RepResult& r) {
  Serial.print("   peak ");
  Serial.print(r.peakDeg, 0);
  Serial.print(" deg | up ");
  Serial.print(r.liftSec, 2);
  Serial.print(" s | down ");
  Serial.print(r.lowerSec, 2);
  Serial.print(" s | swing ");
  Serial.print(r.swingG, 2);
  Serial.println(" g");
}

// ---------- modes ----------
void startZeroing() {
  mode = MODE_ZEROING;
  zeroCount = 0;
  zeroAcc = zeroGyr = {0, 0, 0};
  zeroStartedAt = lastStillWarning = millis();
  Serial.println();
  Serial.println("GET READY: let the arm hang straight down and keep it still...");
}

void endSet() {
  if (mode == MODE_ZEROING) {
    mode = MODE_IDLE;
    Serial.println("Cancelled.");
    return;
  }
  mode = MODE_IDLE;
  int reps = tracker.reps(), good = tracker.goodReps();
  Serial.println();
  Serial.print("SET FINISHED: ");
  Serial.print(reps);
  Serial.print(" reps, ");
  Serial.print(good);
  Serial.print(" good");
  if (reps > 0) {
    Serial.print(" (");
    Serial.print(100 * good / reps);
    Serial.print("%)");
  }
  Serial.println();
  Serial.println("Type s to start another set.");
}

void handleCommand(char c) {
  switch (c) {
    case 's': case 'S':
      if (mode == MODE_IDLE) startZeroing();
      else Serial.println("A set is already running. Type e to end it first.");
      break;
    case 'r': case 'R':
      if (mode != MODE_SET) {
        Serial.println("Start a set first (s), then type r.");
      } else {
        tracker.teachNextRep();
        Serial.println("OK - the NEXT rep will be saved as the reference. Do one rep the way the kinesiologist wants it.");
      }
      break;
    case 'e': case 'E':
      if (mode == MODE_IDLE) Serial.println("No set is running.");
      else endSet();
      break;
    case 'p': case 'P':
      plotMode = !plotMode;
      Serial.println(plotMode ? "Live angle ON (open Tools > Serial Plotter)" : "Live angle OFF");
      break;
    case 'i': case 'I':
      printTargets();
      break;
    case 'h': case 'H': case '?':
      printHelp();
      break;
    default:
      break;  // ignore Enter / other keys
  }
}

// ---------- sampling ----------
void onSample() {
  curl::Vec3 a, g;
  if (!readSensor(a, g)) {
    if (!sensorErrorShown) {
      Serial.println("ERROR: lost contact with the BMX160. Check the wires, then press the board's RESET button.");
      sensorErrorShown = true;
    }
    return;
  }
  sensorErrorShown = false;
  float t = millis() / 1000.0f;

  if (mode == MODE_ZEROING) {
    // Needs ZERO_SAMPLES in a row where the arm is still:
    // total accel close to 1 g and hardly any rotation.
    bool still = fabsf(curl::vlen(a) - 1.0f) < 0.08f && curl::vlen(g) < 5.0f * DEG_TO_RAD_F;
    if (!still) {
      zeroCount = 0;
      zeroAcc = zeroGyr = {0, 0, 0};
      if (millis() - lastStillWarning > 3000) {
        Serial.println("  ...still moving - keep the arm hanging still");
        lastStillWarning = millis();
      }
      return;
    }
    zeroAcc.x += a.x; zeroAcc.y += a.y; zeroAcc.z += a.z;
    zeroGyr.x += g.x; zeroGyr.y += g.y; zeroGyr.z += g.z;
    if (++zeroCount >= ZERO_SAMPLES) {
      gyroBias = {zeroGyr.x / zeroCount, zeroGyr.y / zeroCount, zeroGyr.z / zeroCount};
      tracker.beginSet({zeroAcc.x / zeroCount, zeroAcc.y / zeroCount, zeroAcc.z / zeroCount});
      mode = MODE_SET;
      Serial.println("GO! Start curling. (type r for a reference rep, e to end the set)");
      printTargets();
    }
    return;
  }

  if (mode != MODE_SET) return;

  curl::Vec3 w = {g.x - gyroBias.x, g.y - gyroBias.y, g.z - gyroBias.z};
  curl::RepResult r;
  if (tracker.update(a, w, t, r)) {
    if (r.isReference) {
      ledGood();
      Serial.println("REFERENCE REP SAVED.");
      printRepDetails(r);
      printTargets();
    } else {
      if (r.good) ledGood(); else ledBad();
      Serial.print("Rep ");
      Serial.print(r.number);
      Serial.print(": ");
      if (r.good) {
        Serial.println("GOOD");
      } else {
        Serial.print("NEEDS WORK - ");
        Serial.println(curl::Tracker::faultText(r.faults));
      }
      printRepDetails(r);
    }
  }
  if (plotMode) {
    Serial.print("angle:");
    Serial.print(tracker.angle(), 1);
    Serial.print(",target:");
    Serial.println(tracker.s.targetPeak, 0);
  }
}

// ---------- setup / loop ----------
void setup() {
  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, LOW);
  Serial.begin(115200);
  uint32_t t0 = millis();
  while (!Serial && millis() - t0 < 3000) {}  // give the Serial Monitor time to connect

  Serial.println();
  Serial.println("=== Curl Strap ===");
  SENSOR_WIRE.begin();
  SENSOR_WIRE.setClock(400000);

  if (!setupSensor()) {
    Serial.println("ERROR: BMX160 not found at address 0x68 or 0x69.");
    scanBus();
    Serial.println("Fix the wiring, then press the RESET button on the Arduino.");
    while (true) {  // fast blink = sensor problem
      digitalWrite(STATUS_LED, !digitalRead(STATUS_LED));
      delay(100);
    }
  }
  Serial.print("BMX160 found at address 0x");
  Serial.println(sensorAddr, HEX);
  printHelp();
  Serial.println("Type s and press Enter to start a set.");
}

void loop() {
  while (Serial.available()) handleCommand((char)Serial.read());

  uint32_t now = millis();
  if (now - lastSample >= SAMPLE_MS) {
    lastSample = now;
    onSample();
  }
  updateLed();
}
