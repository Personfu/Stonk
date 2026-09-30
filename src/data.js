(() => {
  const projectUrl = "https://rbkcgfxmhqvkzkpfpabf.supabase.co";
  // This is a Supabase publishable key, designed for public clients. RLS allows reads only.
  const publishableKey = "sb_publishable_0Oh2W6upXzlCC0zRK-iCOQ_ym_3PPvC";
  const sectionNames = ["suppliers", "customers", "indices", "competitors", "holders", "analysts", "board", "leadership"];

  function emptySections() {
    return Object.fromEntries(sectionNames.map((name) => [name, []]));
  }

  async function table(path) {
    const response = await fetch(`${projectUrl}/rest/v1/${path}`, {
      headers: { apikey: publishableKey, Accept: "application/json" },
      signal: AbortSignal.timeout(6500),
    });
    if (!response.ok) throw new Error(`Research data unavailable: ${response.status}`);
    return response.json();
  }

  async function fromDirectory(ticker) {
    try {
      const response = await fetch(`/api/lookup?ticker=${encodeURIComponent(ticker)}`, {
        signal: AbortSignal.timeout(6500),
      });
      if (!response.ok) return null;
      const payload = await response.json();
      if (!payload.company) return null;
      const { name, exchange, kind, asOf } = payload.company;
      return {
        company: {
          name, ticker, exchange, sector: kind === "ETF" ? "Exchange traded fund" : "Listed security",
          description: "Security identity is from the Nasdaq Trader symbol directory. This relationship map is awaiting source review.",
          asOf, sourceUrl: payload.source,
        },
        coverage: {
          label: "Identity only",
          note: "No suppliers, customers, ownership, analyst or people records have been sourced for this ticker yet.",
          sourceUrl: payload.source,
        },
        sections: emptySections(),
      };
    } catch {
      return null;
    }
  }

  async function loadCompany(rawTicker) {
    const ticker = String(rawTicker || "").trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(ticker)) return null;
    try {
      const profiles = await table(`research_companies?ticker=eq.${encodeURIComponent(ticker)}&select=*`);
      if (profiles.length) {
        const [relationships] = await Promise.all([
          table(`research_relationships?company_ticker=eq.${encodeURIComponent(ticker)}&select=section,name,related_ticker,detail,source_url,source_label,as_of,status&order=name.asc`),
        ]);
        const row = profiles[0];
        const sections = emptySections();
        for (const edge of relationships) {
          if (!sections[edge.section]) continue;
          sections[edge.section].push({
            name: edge.name, ticker: edge.related_ticker || undefined,
            detail: edge.detail, sourceUrl: edge.source_url,
            sourceLabel: edge.source_label, asOf: edge.as_of, status: edge.status,
          });
        }
        return {
          company: {
            name: row.name, ticker: row.ticker, exchange: row.exchange,
            sector: row.sector, description: row.description,
            asOf: row.as_of, sourceUrl: row.source_url,
          },
          coverage: {
            label: "Curated public-source coverage", note: row.coverage_note,
            sourceUrl: row.coverage_source_url,
          },
          sections,
        };
      }
    } catch {
      // Read a checked-in research snapshot when the public database is unavailable.
    }
    try {
      const local = await fetch(`/data/${encodeURIComponent(ticker.toLowerCase())}.json`, {
        cache: "no-store", signal: AbortSignal.timeout(3000),
      });
      if (local.ok) {
        const profile = await local.json();
        if (profile?.company?.ticker === ticker && profile?.sections) return profile;
      }
    } catch {
      // Fall through to a basic directory identity.
    }
    return fromDirectory(ticker);
  }

  async function searchCompanies(query) {
    const value = String(query || "").trim();
    if (!value) return [];
    try {
      const response = await fetch(`/api/lookup?q=${encodeURIComponent(value.slice(0, 80))}`, {
        signal: AbortSignal.timeout(6500),
      });
      if (!response.ok) return [];
      const result = await response.json();
      return result.companies || [];
    } catch {
      return [];
    }
  }

  window.StonkData = { loadCompany, searchCompanies };
})();
