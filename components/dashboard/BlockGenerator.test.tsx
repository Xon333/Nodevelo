import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import BlockGenerator from "./BlockGenerator";

test("keeps the generator fields at two columns until the xl breakpoint", () => {
  const html = renderToStaticMarkup(
    <BlockGenerator
      hasActiveBlock={false}
      genOpen={true}
      setGenOpen={() => {}}
      lengthWeeks={4}
      setLengthWeeks={() => {}}
      startDate="2026-07-13"
      setStartDate={() => {}}
      goal="Build endurance"
      setGoal={() => {}}
      weakpointsText="Climbing"
      setWeakpointsText={() => {}}
      generating={false}
      generate={() => {}}
      generateError={null}
      elapsed={0}
      intervalsConfigured={true}
      showSyncTip={false}
      seasonReadout={null}
      focusLabel={null}
      goalCount={0}
      onSaveToProfile={() => {}}
      profileSaveState={{ state: "idle" }}
    />,
  );

  expect(html).toContain("sm:grid-cols-2");
  expect(html).toContain("xl:grid-cols-4");
  expect(html).not.toContain("lg:grid-cols-4");
  expect(html).not.toContain("disabled=\"\"");
  expect(html).not.toContain("Connect the AI coach");
});
