import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import type { Mission, Waypoint } from "@droneroute/shared";
import {
  DEFAULT_MISSION_CONFIG,
  DEFAULT_WAYPOINT,
  kmzFileName,
} from "@droneroute/shared";
import { generateKmzBuffer, layoutForTarget } from "./kmzGenerator.js";
import {
  buildTemplateKml,
  buildWaylinesWpml,
  normalizeHeading,
} from "../lib/wpml.js";
import {
  ImportError,
  MAX_IMPORT_WAYPOINTS,
  importMissionFile,
  parseGpx,
  parseKml,
  parseLitchiCsv,
  thinPoints,
} from "./missionImport.js";

function wp(index: number, extra: Partial<Waypoint> = {}): Waypoint {
  return {
    ...DEFAULT_WAYPOINT,
    index,
    name: `Waypoint ${index + 1}`,
    latitude: 41.25 + index * 0.001,
    longitude: 0.93,
    actions: [],
    ...extra,
  };
}

function mission(waypoints: Waypoint[]): Mission {
  return {
    id: "m",
    name: "Test",
    createdAt: "",
    updatedAt: "",
    config: { ...DEFAULT_MISSION_CONFIG, autoFlightSpeed: 6 },
    waypoints,
    pois: [],
    obstacles: [],
  };
}

async function zipOf(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("WPML KMZ import", () => {
  it("round-trips waypoints, action params and interval capture", async () => {
    const original = mission([
      wp(0, { photoIntervalM: 18.5, height: 80, gimbalPitchAngle: -90 }),
      wp(1, {
        actions: [
          { actionId: 0, actionType: "hover", params: { hoverTime: 12 } },
          {
            actionId: 1,
            actionType: "takePhoto",
            params: { payloadPositionIndex: 0 },
          },
        ],
      }),
      wp(2, { useGlobalSpeed: false, speed: 3 }),
    ]);
    const buffer = await generateKmzBuffer(original);
    const result = await importMissionFile(buffer, "route.kmz");

    expect(result.format).toBe("wpml");
    expect(result.config?.autoFlightSpeed).toBe(6);
    expect(result.waypoints).toHaveLength(3);
    expect(result.waypoints.map((w) => w.index)).toEqual([0, 1, 2]);

    const [first, second, third] = result.waypoints;
    expect(first.photoIntervalM).toBe(18.5);
    expect(first.height).toBe(80);
    expect(first.actions).toEqual([]);
    expect(second.photoIntervalM).toBeUndefined();
    // Params come back under the names the editor and exporter use
    expect(second.actions).toEqual([
      { actionId: 0, actionType: "hover", params: { hoverTime: 12 } },
      {
        actionId: 1,
        actionType: "takePhoto",
        params: { payloadPositionIndex: 0, fileSuffix: "" },
      },
    ]);
    expect(third.speed).toBe(3);
    expect(third.useGlobalSpeed).toBe(false);
  });

  it("exports unique action group ids", async () => {
    const xml = buildWaylinesWpml(
      mission([
        wp(0, {
          photoIntervalM: 10,
          actions: [
            {
              actionId: 0,
              actionType: "takePhoto",
              params: { payloadPositionIndex: 0 },
            },
          ],
        }),
        wp(1, { photoIntervalM: 10 }),
        wp(2, { photoIntervalM: 10 }),
      ]),
    );
    const ids = [...xml.matchAll(/<wpml:actionGroupId>(\d+)</g)].map(
      (m) => m[1],
    );
    expect(ids).toHaveLength(3); // no trigger on the last waypoint
    expect(new Set(ids).size).toBe(ids.length);
    expect(xml).toContain(
      "<wpml:actionTriggerType>multipleDistance</wpml:actionTriggerType>",
    );
    expect(xml).toContain(
      "<wpml:actionTriggerParam>10</wpml:actionTriggerParam>",
    );
  });

  it("reads files with only wpmz/waylines.wpml, out-of-order indices and unknown actions", async () => {
    const waylines = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.6">
<Document>
  <wpml:missionConfig>
    <wpml:droneInfo><wpml:droneEnumValue>77</wpml:droneEnumValue></wpml:droneInfo>
  </wpml:missionConfig>
  <Folder>
    <wpml:autoFlightSpeed>9</wpml:autoFlightSpeed>
    <Placemark>
      <Point><coordinates>0.94,41.26</coordinates></Point>
      <wpml:index>1</wpml:index>
      <wpml:executeHeight>60</wpml:executeHeight>
    </Placemark>
    <Placemark>
      <Point><coordinates>0.93,41.25</coordinates></Point>
      <wpml:index>0</wpml:index>
      <wpml:executeHeight>60</wpml:executeHeight>
      <wpml:actionGroup>
        <wpml:actionGroupId>0</wpml:actionGroupId>
        <wpml:actionGroupStartIndex>0</wpml:actionGroupStartIndex>
        <wpml:actionGroupEndIndex>1</wpml:actionGroupEndIndex>
        <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
        <wpml:actionTrigger>
          <wpml:actionTriggerType>multipleTiming</wpml:actionTriggerType>
          <wpml:actionTriggerParam>2</wpml:actionTriggerParam>
        </wpml:actionTrigger>
        <wpml:action>
          <wpml:actionId>0</wpml:actionId>
          <wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc>
        </wpml:action>
      </wpml:actionGroup>
      <wpml:actionGroup>
        <wpml:actionGroupId>1</wpml:actionGroupId>
        <wpml:actionGroupStartIndex>0</wpml:actionGroupStartIndex>
        <wpml:actionGroupEndIndex>0</wpml:actionGroupEndIndex>
        <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
        <wpml:actionTrigger>
          <wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>
        </wpml:actionTrigger>
        <wpml:action>
          <wpml:actionId>0</wpml:actionId>
          <wpml:actionActuatorFunc>panoShot</wpml:actionActuatorFunc>
        </wpml:action>
      </wpml:actionGroup>
    </Placemark>
  </Folder>
</Document>
</kml>`;
    const result = await importMissionFile(
      await zipOf({ "wpmz/waylines.wpml": waylines }),
      "dji.kmz",
    );

    expect(result.waypoints.map((w) => w.longitude)).toEqual([0.93, 0.94]);
    expect(result.waypoints.map((w) => w.index)).toEqual([0, 1]);
    // 2 s at 9 m/s
    expect(result.waypoints[0].photoIntervalM).toBe(18);
    expect(result.waypoints[0].actions).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/panoShot/);
    expect(result.warnings.join(" ")).toMatch(/Timed interval/);
  });

  it("falls back to waylines when the template only has a mapping polygon", async () => {
    const template = `<kml xmlns:wpml="http://www.dji.com/wpmz/1.0.6"><Document>
      <wpml:missionConfig/>
      <Folder><wpml:templateType>mapping2d</wpml:templateType>
        <Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>0.93,41.25,0 0.94,41.25,0 0.94,41.26,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
      </Folder></Document></kml>`;
    const waylines = `<kml xmlns:wpml="http://www.dji.com/wpmz/1.0.6"><Document><Folder>
      <Placemark><Point><coordinates>0.93,41.25</coordinates></Point><wpml:index>0</wpml:index></Placemark>
      <Placemark><Point><coordinates>0.94,41.25</coordinates></Point><wpml:index>1</wpml:index></Placemark>
      </Folder></Document></kml>`;
    const result = await importMissionFile(
      await zipOf({
        "wpmz/template.kml": template,
        "wpmz/waylines.wpml": waylines,
      }),
      "area.kmz",
    );
    expect(result.waypoints).toHaveLength(2);
    expect(result.warnings.join(" ")).toMatch(/not a plain waypoint route/);
  });
});

describe("KML import", () => {
  const kml = (body: string) =>
    `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${body}</Document></kml>`;

  it("imports a LineString as waypoints and placemarks as POIs", () => {
    const result = parseKml(
      kml(`<Folder>
        <Placemark><LineString><coordinates>
          0.93,41.25,0 0.94,41.25,0
          0.94,41.26,0
        </coordinates></LineString></Placemark>
        <Placemark><Point><coordinates>0.935,41.255,0</coordinates></Point></Placemark>
      </Folder>`),
    );
    expect(result.format).toBe("kml");
    expect(result.waypoints.map((w) => [w.latitude, w.longitude])).toEqual([
      [41.25, 0.93],
      [41.25, 0.94],
      [41.26, 0.94],
    ]);
    expect(result.waypoints[0].height).toBe(DEFAULT_WAYPOINT.height);
    expect(result.pois).toHaveLength(1);
    expect(result.warnings.join(" ")).toMatch(/no heights above ground/);
  });

  it("uses altitudes only when they are relative to ground", () => {
    const result = parseKml(
      kml(`<Placemark><LineString><altitudeMode>relativeToGround</altitudeMode>
        <coordinates>0.93,41.25,60 0.94,41.25,75.25</coordinates></LineString></Placemark>`),
    );
    expect(result.waypoints.map((w) => w.height)).toEqual([60, 75.3]);
    expect(result.warnings).toEqual([]);
  });

  it("imports a polygon outline without its closing vertex", () => {
    const result = parseKml(
      kml(`<Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>
        0.93,41.25 0.94,41.25 0.94,41.26 0.93,41.25
      </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`),
    );
    expect(result.waypoints).toHaveLength(3);
    expect(result.warnings.join(" ")).toMatch(/polygon outline/);
  });

  it("imports bare placemarks in order", () => {
    const result = parseKml(
      kml(`<Placemark><Point><coordinates>0.93,41.25</coordinates></Point></Placemark>
           <Placemark><Point><coordinates>0.94,41.26</coordinates></Point></Placemark>`),
    );
    expect(result.waypoints).toHaveLength(2);
    expect(result.pois).toEqual([]);
  });

  it("thins very long paths", () => {
    const coords = Array.from(
      { length: 3000 },
      (_, i) => `${0.9 + i * 1e-5},41.25`,
    ).join(" ");
    const result = parseKml(
      kml(
        `<Placemark><LineString><coordinates>${coords}</coordinates></LineString></Placemark>`,
      ),
    );
    expect(result.waypoints).toHaveLength(MAX_IMPORT_WAYPOINTS);
    expect(result.waypoints[0].longitude).toBeCloseTo(0.9, 9);
    expect(result.waypoints.at(-1)!.longitude).toBeCloseTo(0.92999, 9);
    expect(result.warnings.join(" ")).toMatch(/thinned/);
  });

  it("rejects documents without usable geometry or with bad coordinates", () => {
    expect(() => parseKml(kml(""))).toThrow(ImportError);
    expect(() => parseKml("<html></html>")).toThrow(ImportError);
    expect(() =>
      parseKml(
        kml(
          `<Placemark><Point><coordinates>500,900</coordinates></Point></Placemark>`,
        ),
      ),
    ).toThrow(ImportError);
  });

  it("does not expand entities", () => {
    const text = `<?xml version="1.0"?><!DOCTYPE kml [<!ENTITY x "0.93,41.25 0.94,41.26">]>
      <kml><Document><Placemark><LineString><coordinates>&x;</coordinates></LineString></Placemark></Document></kml>`;
    expect(() => parseKml(text)).toThrow(ImportError);
  });

  it("reads a plain Google Earth KMZ", async () => {
    const buffer = await zipOf({
      "doc.kml": kml(
        `<Placemark><LineString><coordinates>0.93,41.25 0.94,41.26</coordinates></LineString></Placemark>`,
      ),
    });
    const result = await importMissionFile(buffer, "earth.KMZ");
    expect(result.format).toBe("kml");
    expect(result.config).toBeUndefined();
    expect(result.waypoints).toHaveLength(2);
  });
});

describe("GPX import", () => {
  const gpx = (body: string) =>
    `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`;

  it("prefers a route, then a track, and turns waypoints into POIs", () => {
    const result = parseGpx(
      gpx(`<wpt lat="41.255" lon="0.935"><name>Tower</name></wpt>
        <trk><trkseg>
          <trkpt lat="41.25" lon="0.93"><ele>312</ele></trkpt>
          <trkpt lat="41.26" lon="0.94"><ele>318</ele></trkpt>
        </trkseg><trkseg>
          <trkpt lat="41.27" lon="0.95"/>
        </trkseg></trk>`),
    );
    expect(result.format).toBe("gpx");
    expect(result.waypoints.map((w) => w.latitude)).toEqual([
      41.25, 41.26, 41.27,
    ]);
    // Sea-level elevations are not used as flight heights
    expect(result.waypoints[0].height).toBe(DEFAULT_WAYPOINT.height);
    expect(result.pois).toHaveLength(1);
  });

  it("imports bare waypoints as the route", () => {
    const result = parseGpx(
      gpx(`<wpt lat="41.25" lon="0.93"/><wpt lat="41.26" lon="0.94"/>`),
    );
    expect(result.waypoints).toHaveLength(2);
    expect(result.pois).toEqual([]);
  });

  it("rejects empty or foreign documents", () => {
    expect(() => parseGpx(gpx(""))).toThrow(ImportError);
    expect(() => parseGpx("<kml/>")).toThrow(ImportError);
  });
});

describe("Litchi CSV import", () => {
  const HEADER =
    "latitude,longitude,altitude(m),heading(deg),curvesize(m),rotationdir,gimbalmode,gimbalpitchangle,actiontype1,actionparam1,actiontype2,actionparam2,altitudemode,speed(m/s),poi_latitude,poi_longitude,poi_altitude(m),poi_altitudemode,photo_timeinterval,photo_distinterval";

  it("maps columns to waypoint settings", () => {
    const csv = [
      "﻿" + HEADER,
      "41.25,0.93,50,270,0,0,2,-45,1,0,0,3000,0,5,0,0,0,0,-1,12",
      "41.26,0.94,60.5,90,8,0,0,0,-1,0,-1,0,0,0,41.255,0.935,2,0,-1,-1",
      "",
    ].join("\r\n");
    const result = parseLitchiCsv(csv);

    expect(result.format).toBe("litchi");
    expect(result.waypoints).toHaveLength(2);
    const [a, b] = result.waypoints;

    expect(a.height).toBe(50);
    expect(a.speed).toBe(5);
    expect(a.useGlobalSpeed).toBe(false);
    expect(a.headingMode).toBe("smoothTransition");
    expect(a.headingAngle).toBe(-90);
    expect(a.turnMode).toBe("toPointAndStopWithDiscontinuityCurvature");
    expect(a.gimbalPitchAngle).toBe(-45);
    expect(a.photoIntervalM).toBe(12);
    expect(a.actions.map((x) => x.actionType)).toEqual(["takePhoto", "hover"]);
    expect(a.actions[1].params).toEqual({ hoverTime: 3 });

    expect(b.height).toBe(60.5);
    expect(b.useGlobalSpeed).toBe(true);
    expect(b.turnMode).toBe("toPointAndPassWithContinuityCurvature");
    expect(b.turnDampingDist).toBe(8);
    expect(b.headingMode).toBe("towardPOI");
    expect(b.poiId).toBe(result.pois[0].id);
    expect(result.pois[0]).toMatchObject({
      latitude: 41.255,
      longitude: 0.935,
      height: 2,
    });
  });

  it("skips bad rows and rejects non-Litchi files", () => {
    const result = parseLitchiCsv(
      `${HEADER}\nnot,a,row\n41.25,0.93,50\n999,0.93,50`,
    );
    expect(result.waypoints).toHaveLength(1);
    expect(result.warnings.join(" ")).toMatch(/2 rows/);

    expect(() => parseLitchiCsv("a,b,c\n1,2,3")).toThrow(ImportError);
    expect(() => parseLitchiCsv(HEADER)).toThrow(ImportError);
  });
});

describe("importMissionFile", () => {
  it("rejects unsupported extensions and mismatched contents", async () => {
    await expect(
      importMissionFile(Buffer.from("x"), "mission.exe"),
    ).rejects.toThrow(/Unsupported file type/);
    await expect(
      importMissionFile(Buffer.from("not a zip"), "mission.kmz"),
    ).rejects.toThrow(ImportError);
    await expect(
      importMissionFile(Buffer.from([0x3c, 0x00, 0x01, 0x02]), "mission.kml"),
    ).rejects.toThrow(/not a text document/);
    await expect(
      importMissionFile(await zipOf({ "readme.txt": "hi" }), "empty.kmz"),
    ).rejects.toThrow(/no KML document/);
  });
});

describe("thinPoints", () => {
  it("keeps both ends and the requested count", () => {
    const points = Array.from({ length: 101 }, (_, i) => i);
    const thinned = thinPoints(points, 11);
    expect(thinned).toHaveLength(11);
    expect(thinned[0]).toBe(0);
    expect(thinned[10]).toBe(100);
    expect(thinPoints([1, 2], 11)).toEqual([1, 2]);
  });
});

describe("drone home point and FlightHub 2 layout", () => {
  const withTakeoff = (takeoff?: Mission["config"]["takeoff"]): Mission => {
    const m = mission([wp(0), wp(1)]);
    return { ...m, config: { ...m.config, takeoff } };
  };
  const names = async (buffer: Buffer) =>
    Object.keys((await JSZip.loadAsync(buffer)).files).sort();

  it("keeps the files at the top level by default", async () => {
    const buffer = await generateKmzBuffer(withTakeoff());
    expect(await names(buffer)).toEqual([
      "res/",
      "template.kml",
      "waylines.wpml",
    ]);
  });

  it("puts the files in wpmz/ for FlightHub 2", async () => {
    expect(layoutForTarget("flighthub2")).toBe("wpmz");
    expect(layoutForTarget(undefined)).toBe("root");
    expect(layoutForTarget("anything-else")).toBe("root");
    const buffer = await generateKmzBuffer(withTakeoff(), "wpmz");
    expect(await names(buffer)).toEqual([
      "wpmz/res/",
      "wpmz/template.kml",
      "wpmz/waylines.wpml",
    ]);
  });

  it("writes the reference take-off point only when one is set", async () => {
    const read = async (m: Mission, file: string) =>
      (await JSZip.loadAsync(await generateKmzBuffer(m, "wpmz")))
        .file(file)!
        .async("string");

    const without = await read(withTakeoff(), "wpmz/template.kml");
    expect(without).not.toContain("takeOffRefPoint");

    const point = { latitude: 41.2571, longitude: 0.9312, elevationM: 87.5 };
    for (const file of ["wpmz/template.kml", "wpmz/waylines.wpml"]) {
      const xml = await read(withTakeoff(point), file);
      expect(xml).toContain(
        "<wpml:takeOffRefPoint>41.2571,0.9312,87.5</wpml:takeOffRefPoint>",
      );
      expect(xml).toContain(
        "<wpml:takeOffRefPointAGLHeight>0</wpml:takeOffRefPointAGLHeight>",
      );
      // Directly after the take-off security height, as in DJI's example.
      expect(xml).toMatch(
        /<\/wpml:takeOffSecurityHeight>\s*<wpml:takeOffRefPoint>/,
      );
    }
    const noElevation = await read(
      withTakeoff({ latitude: 41.2571, longitude: 0.9312 }),
      "wpmz/template.kml",
    );
    expect(noElevation).toContain(
      "<wpml:takeOffRefPoint>41.2571,0.9312,0</wpml:takeOffRefPoint>",
    );
  });

  it("reads the take-off point back from either layout", async () => {
    const point = { latitude: 41.2571, longitude: 0.9312, elevationM: 87.5 };
    for (const layout of ["root", "wpmz"] as const) {
      const buffer = await generateKmzBuffer(withTakeoff(point), layout);
      const result = await importMissionFile(buffer, "route.kmz");
      expect(result.config?.takeoff).toEqual(point);
      expect(result.waypoints).toHaveLength(2);
    }
    const none = await importMissionFile(
      await generateKmzBuffer(withTakeoff(), "wpmz"),
      "route.kmz",
    );
    expect(none.config?.takeoff).toBeUndefined();
  });
});

describe("kmzFileName", () => {
  it("uses only characters DJI accepts in a route name", () => {
    const name = kmzFileName(
      'Crestwood Rd - site_grid + orbit (draft) v1.2 <a>:"/|?*\\',
    );
    expect(name).toBe("Crestwood Rd - site grid orbit draft v1 2 a.kmz");
    expect(name.slice(0, -4)).not.toMatch(/[<>:"/|?*._\\]/);
    expect(
      kmzFileName("Crestwood Rd - site grid + foundation orbit (draft)"),
    ).toBe("Crestwood Rd - site grid foundation orbit draft.kmz");
    expect(kmzFileName("Ünïcode straße 12")).toBe("Ünïcode straße 12.kmz");
    expect(kmzFileName("___")).toBe("mission.kmz");
  });
});

describe("matches DJI's own exports", () => {
  it("uses the WPML version and fields of real Pilot 2 / FlightHub 2 files", async () => {
    const zip = await JSZip.loadAsync(
      await generateKmzBuffer(mission([wp(0), wp(1)]), "wpmz"),
    );
    for (const file of ["wpmz/template.kml", "wpmz/waylines.wpml"]) {
      const xml = await zip.file(file)!.async("string");
      expect(xml).toContain('xmlns:wpml="http://www.dji.com/wpmz/1.0.6"');
      expect(xml).toContain(
        "<wpml:payloadSubEnumValue>0</wpml:payloadSubEnumValue>",
      );
      expect(xml).not.toContain("globalRTHHeight");
    }
    const template = await zip.file("wpmz/template.kml")!.async("string");
    expect(template).toContain(
      "<wpml:positioningType>GPS</wpml:positioningType>",
    );
    // payloadParam comes after the waypoints, as in DJI's files
    expect(template.lastIndexOf("</Placemark>")).toBeLessThan(
      template.indexOf("<wpml:payloadParam>"),
    );
  });
});

describe("DJI WPML required elements", () => {
  // An above-ground mission like the ones planned in DroneRoute: a fixed
  // heading waypoint, two that face a POI, per-waypoint turn settings, photos.
  const poi = {
    id: "p",
    name: "Foundation",
    latitude: 41.2505,
    longitude: 0.9305,
    height: 0.5,
  };
  const m: Mission = {
    ...mission([
      wp(0, {
        useGlobalHeadingParam: false,
        headingMode: "fixed",
        headingAngle: 200,
        useGlobalTurnParam: false,
        turnMode: "toPointAndStopWithDiscontinuityCurvature",
        height: 50,
        actions: [
          {
            actionId: 0,
            actionType: "takePhoto",
            params: { payloadPositionIndex: 0 },
          },
        ],
      }),
      wp(1, {
        useGlobalHeadingParam: false,
        headingMode: "towardPOI",
        poiId: "p",
        useGlobalTurnParam: false,
        turnMode: "toPointAndPassWithContinuityCurvature",
        height: 12,
      }),
      wp(2, {
        useGlobalHeadingParam: false,
        headingMode: "towardPOI",
        poiId: "p",
        useGlobalTurnParam: false,
        height: 16,
      }),
    ]),
    pois: [poi],
  };
  m.config = {
    ...m.config,
    heightMode: "aboveGroundLevel",
    takeOffSecurityHeight: 20,
  };
  const count = (xml: string, tag: string) =>
    (xml.match(new RegExp(`<wpml:${tag}>`, "g")) ?? []).length;

  it("normalizes headings into [-180, 180]", () => {
    expect(normalizeHeading(200)).toBe(-160);
    expect(normalizeHeading(180)).toBe(180);
    expect(normalizeHeading(-190)).toBe(170);
    expect(normalizeHeading(45)).toBe(45);
  });

  it("writes an execute height mode DJI accepts in waylines.wpml", () => {
    const xml = buildWaylinesWpml(m);
    expect(xml).toContain(
      "<wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>",
    );
    expect(xml).not.toContain("aboveGroundLevel");
    expect(xml).not.toContain("waylineCoordinateSysParam");
    expect(xml).toMatch(
      /<wpml:templateId>0<\/wpml:templateId>\s*<wpml:executeHeightMode>/,
    );
    for (const angle of xml.matchAll(/<wpml:waypointHeadingAngle>([^<]+)</g)) {
      expect(Math.abs(Number(angle[1]))).toBeLessThanOrEqual(180);
    }
    expect(count(xml, "useStraightLine")).toBe(3); // on every waypoint, as DJI writes it
    expect(xml).toContain("<wpml:useStraightLine>0</wpml:useStraightLine>"); // the curved turn
    expect(count(xml, "waypointGimbalHeadingParam")).toBe(3);
    expect(count(xml, "waypointWorkType")).toBe(3);
    expect(xml).toMatch(/<wpml:distance>\d+(\.\d+)?<\/wpml:distance>/);
    expect(xml).not.toContain("createTime");
  });

  it("gives every template waypoint the parameters DJI requires", () => {
    const xml = buildTemplateKml(m);
    expect(xml).toContain(
      "<wpml:heightMode>relativeToStartPoint</wpml:heightMode>",
    );
    expect(xml).toContain("<wpml:globalHeight>50</wpml:globalHeight>");
    expect(xml).toContain(
      "<wpml:globalUseStraightLine>1</wpml:globalUseStraightLine>",
    );
    expect(xml).toContain("<wpml:imageFormat>wide</wpml:imageFormat>");
    // Three waypoints, none using global heading or turn settings.
    expect(count(xml, "waypointHeadingParam")).toBe(3);
    expect(count(xml, "waypointTurnParam")).toBe(3);
    expect(count(xml, "waypointPoiPoint")).toBe(4); // global block + all three waypoints
    expect(xml).toContain(
      "<wpml:waypointHeadingAngle>-160</wpml:waypointHeadingAngle>",
    );
    expect(xml).toContain(
      "<wpml:useGlobalPayloadLensIndex>1</wpml:useGlobalPayloadLensIndex>",
    );
  });

  it("keeps EGM96 heights as they are, since they cannot be converted", () => {
    const egm = { ...m, config: { ...m.config, heightMode: "EGM96" as const } };
    expect(buildTemplateKml(egm)).toContain(
      "<wpml:heightMode>EGM96</wpml:heightMode>",
    );
    expect(buildWaylinesWpml(egm)).not.toContain("executeHeightMode");
  });

  it("still reads its own export back", async () => {
    const result = await importMissionFile(
      await generateKmzBuffer(m, "wpmz"),
      "route.kmz",
    );
    expect(result.waypoints).toHaveLength(3);
    expect(result.waypoints.map((w) => w.height)).toEqual([50, 12, 16]);
    expect(result.config?.heightMode).toBe("relativeToStartPoint");
  });
});
