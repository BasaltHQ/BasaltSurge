import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const input = searchParams.get("input") || "";
  const placeId = searchParams.get("placeId");

  const apiKey =
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    console.error("[ADDRESS AUTOCOMPLETE API ERROR] GOOGLE_PLACES_API_KEY is not set in environment.");
    return NextResponse.json(
      { error: "GOOGLE_PLACES_API_KEY environment variable is not configured." },
      { status: 500 }
    );
  }

  // 1. Get Place Details if placeId provided
  if (placeId) {
    try {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
        placeId
      )}&fields=address_components,formatted_address&key=${apiKey}`;

      const res = await fetch(url);
      const data = await res.json();

      if (data.status !== "OK") {
        console.error("[GOOGLE PLACES DETAILS API ERROR]", data.status, data.error_message);
        return NextResponse.json(
          { error: data.error_message || data.status },
          { status: 400 }
        );
      }

      const components = data.result?.address_components || [];
      let streetNumber = "";
      let route = "";
      let subpremise = "";
      let city = "";
      let state = "";
      let zip = "";
      let country = "";

      for (const comp of components) {
        const types: string[] = comp.types || [];
        if (types.includes("street_number")) streetNumber = comp.long_name;
        if (types.includes("route")) route = comp.long_name;
        if (types.includes("subpremise")) subpremise = comp.long_name;
        if (types.includes("locality")) city = comp.long_name;
        if (!city && types.includes("sublocality")) city = comp.long_name;
        if (!city && types.includes("postal_town")) city = comp.long_name;
        if (types.includes("administrative_area_level_1")) state = comp.short_name;
        if (types.includes("postal_code")) zip = comp.long_name;
        if (types.includes("country")) country = comp.short_name;
      }

      const streetAddress = [streetNumber, route].filter(Boolean).join(" ");

      return NextResponse.json({
        formattedAddress: data.result?.formatted_address || "",
        streetAddress: streetAddress || input,
        apartment: subpremise ? `Apt ${subpremise}` : "",
        city,
        state,
        zip,
        country,
      });
    } catch (err: any) {
      console.error("[ADDRESS DETAILS API ERROR]", err);
      return NextResponse.json({ error: err?.message || "Failed to fetch place details" }, { status: 500 });
    }
  }

  // 2. Fetch Autocomplete Predictions
  if (!input || input.trim().length < 2) {
    return NextResponse.json({ predictions: [] });
  }

  const countryParam = searchParams.get("country");

  try {
    let url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
      input.trim()
    )}&types=address&key=${apiKey}`;
    if (countryParam && countryParam.length === 2) {
      url += `&components=country:${encodeURIComponent(countryParam.toLowerCase())}`;
    }

    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.error("[GOOGLE PLACES AUTOCOMPLETE REJECTED]", {
        status: data.status,
        error_message: data.error_message,
        input,
      });
      return NextResponse.json(
        { error: data.error_message || data.status, predictions: [] },
        { status: 400 }
      );
    }

    const predictions = (data.predictions || []).map((p: any) => ({
      placeId: p.place_id,
      description: p.description,
      mainText: p.structured_formatting?.main_text || p.description,
      secondaryText: p.structured_formatting?.secondary_text || "",
    }));

    return NextResponse.json({ predictions });
  } catch (err: any) {
    console.error("[ADDRESS AUTOCOMPLETE API ERROR]", err);
    return NextResponse.json({ error: err?.message || "Failed to fetch address suggestions" }, { status: 500 });
  }
}
