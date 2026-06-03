async function testRoutes() {
  const paths = [
    '/api/platform/brands',
    '/api/platform/brands/basaltsurge/config',
    '/api/platform/brands/basaltsurge/catalog',
    '/api/platform/brands/basaltsurge/provision'
  ];

  for (const path of paths) {
    try {
      const url = `http://localhost:3001${path}`;
      console.log(`\nFetching: ${url}`);
      const res = await fetch(url);
      console.log("Status:", res.status);
      const text = await res.text();
      console.log("Content-Type:", res.headers.get("content-type"));
      console.log("Body snippet (first 150 chars):");
      console.log(text.slice(0, 150).replace(/\s+/g, ' '));
    } catch (err) {
      console.error(`Fetch failed for ${path}:`, err);
    }
  }
}

testRoutes();
