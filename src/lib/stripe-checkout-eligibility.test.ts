import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import { isStripeEmbeddedCheckoutEnabled, isUnsupportedStripeCheckoutRegion, normalizeStripeCheckoutCountry } from "./stripe-checkout-eligibility.ts";

test("a refreshed German receipt keeps the embedded checkout enabled in every supported country format", () => {
  for (const country of ["DE", "de", " DEU ", "Germany", "Deutschland"]) {
    const unsupportedRegion = isUnsupportedStripeCheckoutRegion(country, "", "US");
    assert.equal(normalizeStripeCheckoutCountry(country), "DE");
    assert.equal(unsupportedRegion, false);
    assert.equal(isStripeEmbeddedCheckoutEnabled({
      legacyHeadlessEnabled: false,
      v2Active: true,
      unsupportedRegion,
    }), true);
  }
});

test("European country names and alpha-3 codes resolve to the existing supported regions", () => {
  for (const [code, alpha3, name] of [
    ["AT", "AUT", "Austria"], ["BE", "BEL", "Belgium"], ["BG", "BGR", "Bulgaria"],
    ["CY", "CYP", "Cyprus"], ["CZ", "CZE", "Czech Republic"], ["DK", "DNK", "Denmark"],
    ["EE", "EST", "Estonia"], ["ES", "ESP", "Spain"], ["FI", "FIN", "Finland"],
    ["FR", "FRA", "France"], ["GR", "GRC", "Greece"], ["HR", "HRV", "Croatia"],
    ["HU", "HUN", "Hungary"], ["IE", "IRL", "Ireland"], ["IT", "ITA", "Italy"],
    ["LT", "LTU", "Lithuania"], ["LU", "LUX", "Luxembourg"], ["LV", "LVA", "Latvia"],
    ["MT", "MLT", "Malta"], ["NL", "NLD", "Netherlands"], ["PL", "POL", "Poland"],
    ["PT", "PRT", "Portugal"], ["RO", "ROU", "Romania"], ["SE", "SWE", "Sweden"],
    ["SI", "SVN", "Slovenia"], ["SK", "SVK", "Slovakia"], ["NO", "NOR", "Norway"],
    ["IS", "ISL", "Iceland"], ["LI", "LIE", "Liechtenstein"], ["CH", "CHE", "Switzerland"],
    ["GB", "GBR", "United Kingdom"],
  ]) {
    for (const country of [code, alpha3, name]) {
      assert.equal(normalizeStripeCheckoutCountry(country), code);
      assert.equal(isUnsupportedStripeCheckoutRegion(country, "", "CA"), false);
    }
  }
});

test("billing then shipping country take precedence over IP location", () => {
  assert.equal(isUnsupportedStripeCheckoutRegion("Canada", "Germany", "US"), true);
  assert.equal(isUnsupportedStripeCheckoutRegion("Germany", "Canada", "CA"), false);
  assert.equal(isUnsupportedStripeCheckoutRegion("UNKNOWN", "France", "CA"), false);
  assert.equal(isUnsupportedStripeCheckoutRegion("XX", "", "CAN"), true);
  assert.equal(isUnsupportedStripeCheckoutRegion("", "", ""), false);
  assert.equal(isUnsupportedStripeCheckoutRegion("Australia", "Germany", "US"), true);
});

test("both checkout modes enable the embedded hook while unsupported regions remain excluded", () => {
  for (const legacyHeadlessEnabled of [true, false]) {
    for (const v2Active of [true, false]) {
      assert.equal(isStripeEmbeddedCheckoutEnabled({ legacyHeadlessEnabled, v2Active, unsupportedRegion: false }), legacyHeadlessEnabled || v2Active);
      assert.equal(isStripeEmbeddedCheckoutEnabled({ legacyHeadlessEnabled, v2Active, unsupportedRegion: true }), false);
    }
  }
});
