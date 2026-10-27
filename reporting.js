export const ranges = ['LAST_7_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH'];
export function summarize(campaigns) {
  const totals = campaigns.reduce((sum, row) => {
    for (const key of ['impressions', 'clicks', 'cost', 'conversions']) sum[key] += row[key];
    return sum;
  }, { impressions: 0, clicks: 0, cost: 0, conversions: 0 });
  return { ...totals, ctr: totals.impressions ? totals.clicks / totals.impressions : 0, averageCpc: totals.clicks ? totals.cost / totals.clicks : 0 };
}
export function normalizeCampaign(row) {
  const m = row.metrics || {};
  return { id: row.campaign.id, name: row.campaign.name, status: row.campaign.status, channel: row.campaign.advertisingChannelType,
    impressions: Number(m.impressions || 0), clicks: Number(m.clicks || 0), cost: Number(m.costMicros || 0) / 1e6, conversions: Number(m.conversions || 0) };
}
