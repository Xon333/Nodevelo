# ATHLETE PROFILE

> **Note for AI:** This file is the live athlete reference. All training plan generation, nutrition prescriptions, and workout descriptions must be calibrated against the data here. Weight, FTP, and goals are the most frequently updated fields.

---

## PERSONAL DATA

| Parameter | Value |
|-----------|-------|
| Age | 20 |
| Sex | Male |
| Height | 177cm |
| Weight | 62kg |
| Estimated body fat | ~10% |
| Lean body mass | ~55.8kg |
| Bike | S-Works Tarmac SL2 |
| Power meter | Magene PES P515 (spider-based) |

---

## PERFORMANCE DATA

| Parameter | Value |
|-----------|-------|
| FTP | 288W |
| FTP (W/kg) | 4.65 W/kg |
| Threshold HR | 179 BPM |
| Max HR | 200 BPM |
| Weekly training hours (current average) | ~10h |
| Weekly training hours (availability) | 9–14h |

---

## POWER PROFILE (PRs)

| Duration | Watts | W/kg |
|----------|-------|------|
| 5 seconds | 715W | 11.53 |
| 15 seconds | 664W | 10.71 |
| 30 seconds | 531W | 8.35 |
| 1 minute | 472W | 7.47 |
| 2 minutes | 372W | 5.89 |
| 5 minutes | 339W | 5.42 |
| 20 minutes | 302W | 4.82 |
| 30 minutes | 272W | 4.28 |
| 1 hour | 259W | 4.18 |

---

## TRAINING ZONES (Based on 288W FTP / 200 BPM max HR)

| Zone | Name | Power Range | HR Range |
|------|------|------------|----------|
| Z1 | Active Recovery | < 175W | < 120 BPM |
| Z2 | Endurance | 175–216W | 120–152 BPM |
| Z3 | Tempo | 217–259W | 152–170 BPM |
| Z4 | Threshold | 260–302W | 170–182 BPM |
| Z5 | VO2max | 303–346W | 182–194 BPM |
| Z6 | Anaerobic | 347–432W | > 194 BPM |
| Z7 | Neuromuscular | > 432W | Max |

---

## WEAKPOINTS

| Weakpoint | Detail |
|-----------|--------|
| Sprint (0–30s) | Low peak power relative to FTP; sprint form/technique unknown |
| 1-minute power | 472W / 7.47 W/kg — underdeveloped relative to FTP |
| 5-minute power | 339W / 5.42 W/kg — VO2max ceiling limiting FTP headroom |
| Durability | Power drops significantly on rides > 3 hours |
| Recovery | Poor; likely compounded by chronic under-fuelling |
| Nutrition compliance | Eats at the low end of estimated TDEE; BMR + NEAT not well quantified; in-ride fuelling is dialled in but daily intake is inconsistent |
| Training structure | Too many medium-difficulty rides; insufficient true Z2; grey-zone drift common, especially outdoors |
| Descending | Losing speed on descents; form needs work |
| Cornering | Suboptimal cornering technique |

---

## GOALS

| Goal | Target |
|------|--------|
| FTP | 300W |
| 1-minute power | 600W |
| 5-second power | 1000W |
| Nutrition | Dial in daily intake for energy, performance, and quality of life |
| Training | Proper weekly structure with structured recovery; maintain high volume |
| Durability | Sustain power on 3h+ rides |
| Local performance | Hill KOMs in Novo Mesto area, Slovenia |
| Racing | Begin competing at amateur level |

---

## DAILY NUTRITION FORMULA

### Training Days
```
Daily Target = 2000 + Activity Burn + Buffer
```

| Component | Value | Notes |
|-----------|-------|-------|
| Base | 2000 kcal | Fixed base (covers BMR + baseline NEAT) |
| Activity burn | Pulled from Intervals.icu post-ride kJ data | kJ ≈ kcal at ~1:1 for cyclists |
| Buffer | TBD — to be defined per training block | Accounts for weight trend; increase if weight trending low, decrease if trending high |

### Rest Days
```
Daily Target = 2600 kcal
```

### Known Issues with Current Formula
- Buffer values are often skipped or set too low
- Rest day target of 2600 kcal feels uncertain — unclear if it is too high or too low
- BMR + NEAT is not well quantified, making base estimate approximate
- Result: chronic under-fuelling, particularly on hard training days and during recovery

### Weight-Trend Adjustment Logic
- **Weight trending below target:** Increase buffer by 100–200 kcal/day until trend stabilises
- **Weight trending above target:** Reduce buffer by 100–200 kcal/day
- **Target weight:** 62kg (current); adjust if goal W/kg requires re-evaluation
- Buffer adjustments should be reviewed at the end of each mesocycle, using weight data synced from Intervals.icu

---

## NOTES FOR PLAN GENERATION

- Rider is 20 years old with good recovery capacity but currently under-fuelling — plans should include explicit nutrition reminders in workout descriptions
- Grey-zone drift is a known issue outdoors; Z2 sessions should include strict HR ceiling cues (< 152 BPM), not just power targets
- Sprint and 1-minute power are priority weakpoints for upcoming blocks alongside FTP target
- Durability work (long Z2 rides) should be built into every mesocycle
- Training plan should account for 9–14h weekly availability — use lower end (9–10h) for recovery weeks, upper end (12–14h) for build weeks
