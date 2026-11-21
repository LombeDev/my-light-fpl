/* Pitch view (My team and manager pages). Players sit on a lightly tinted, greyed pitch background. */
.pv2 {
  --cw: clamp(56px, 17vw, 96px);   /* card width */
  --sh: clamp(42px, 11vw, 66px);   /* shirt height */
  --cf: clamp(10px, 2.9vw, 13px);  /* card text size */

  width: 100vw;
  margin-left: calc(50% - 50vw);
}

.pv2-field {
  position: relative;
  padding: 16px 10px 22px;
  background: #c9e8d8;
  overflow: hidden;
}
.pv2-field::after {
  content: "";
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.22);
  pointer-events: none;
}
.pv2-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
}
.pv2-bg svg {
  display: block;
  width: 100%;
  height: 100%;
}

.pv2-lines {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pv2-line {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-evenly;
  row-gap: 12px;
}

/* Card: shirt, then name, points box and ownership percentage. */
.pv2-card {
  width: var(--cw);
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: var(--cf);
  line-height: 1.2;
  color: #111;
  text-align: center;
}

.pv2-shirt {
  position: relative;
  width: 100%;
  height: var(--sh);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.pv2-shirt img {
  height: 100%;
  width: auto;
  max-width: 100%;
  object-fit: contain;
  filter: drop-shadow(0 3px 3px rgba(0, 0, 0, 0.25));
}

/* Status icon, top left of the shirt. */
.pv2-status {
  position: absolute;
  left: 0;
  top: 0;
  width: calc(var(--cf) * 2.2);
  height: calc(var(--cf) * 2.2);
  border-radius: 50%;
  background: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: calc(var(--cf) * 1.2);
  line-height: 1;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

/* Captain badge: white circle, bottom right of the shirt. */
.pv2-cap {
  position: absolute;
  right: 0;
  bottom: 6px;
  width: calc(var(--cf) * 2.1);
  height: calc(var(--cf) * 2.1);
  box-sizing: border-box;
  border-radius: 50%;
  background: #ffffff;
  color: #111;
  font-weight: 800;
  font-size: var(--cf);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

/* Vice-captain badge: white circle with a blue outline. */
.pv2-cap.is-v {
  border: 2px solid #4450d8;
  color: #4450d8;
}

.pv2-name {
  margin-top: 2px;
  max-width: 100%;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pv2-pts {
  margin-top: 4px;
  min-width: 70%;
  padding: 3px 0;
  border-radius: 6px;
  background: #ffffff;
  color: #111;
  font-weight: 700;
  font-size: calc(var(--cf) * 1.2);
  font-variant-numeric: tabular-nums;
}
.pv2-pts.is-zero {
  background: #d4d8dd;
  color: #444a52;
}

.pv2-eo {
  margin-top: 3px;
  color: #5b6670;
  font-weight: 600;
  font-size: calc(var(--cf) * 1.05);
  font-variant-numeric: tabular-nums;
}

/* Bench panel below the pitch. */
.pv2-bench {
  padding: 12px 10px 18px;
  background: #eef0f3;
}
.pv2-bench-title {
  margin: 2px 0 10px;
  text-align: center;
  font-weight: 700;
  font-size: 15px;
  color: #2b3440;
}

@media (prefers-color-scheme: dark) {
  .pv2-field { background: #1f3a2c; }
  .pv2-field::after { background: rgba(0, 0, 0, 0.25); }
  .pv2-card { color: #eee; }
  .pv2-status,
  .pv2-cap { background: #20242a; color: #eee; }
  .pv2-cap.is-v { background: #20242a; color: #8e9bff; border-color: #8e9bff; }
  .pv2-pts { background: #20242a; color: #eee; }
  .pv2-pts.is-zero { background: #2d3138; color: #aab0b8; }
  .pv2-eo { color: #aab0b8; }
  .pv2-bench { background: #262a30; }
  .pv2-bench-title { color: #dde1e6; }
}
