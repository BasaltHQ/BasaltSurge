"use client";

import React, { useEffect, useState, useRef } from "react";
import { useActiveAccount } from "thirdweb/react";
import {
  ProfileHeader,
  StatusSection,
  InterestsSection,
  ContactSection,
  RelationshipSection,
  LinksSection,
  AboutSection,
  HeroBanner,
  RolesSection
} from "@/components/profile";
import { EditFormTabs } from "@/components/profile/EditFormTabs";
import { ProfileRingModal, RingPreference, ShopRewardSummary } from "@/components/ProfileRingModal";
import { calculateLevelProgress, DEFAULT_LOYALTY_CONFIG, LoyaltyConfig } from "@/utils/loyalty-math";
import { SolarSystemConfig } from "@/components/GenerativeArtBadge";

type LinkItem = { label: string; url: string };
type InterestItem = { name: string; category: string };
type ContactInfo = { email?: string; phone?: string; location?: string; website?: string; showEmail?: boolean; showPhone?: boolean; showLocation?: boolean; showWebsite?: boolean };
type StatusInfo = { message?: string; mood?: string; updatedAt?: number };
type RelationshipInfo = { status?: string; partner?: string };

export function ProfilePanel() {
  const account = useActiveAccount();
  const wallet = (account?.address || "").toLowerCase();
  const [loading, setLoading] = useState(false);
  const [pfpUrl, setPfpUrl] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [msg, setMsg] = useState("");
  const [xp, setXp] = useState(0);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadBgBusy, setUploadBgBusy] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [interests, setInterests] = useState<InterestItem[]>([]);
  const [contact, setContact] = useState<ContactInfo>({ showEmail: true, showPhone: false, showLocation: true, showWebsite: true });
  const [status, setStatus] = useState<StatusInfo>({});
  const [relationship, setRelationship] = useState<RelationshipInfo>({});
  const [snapshot, setSnapshot] = useState<any>({});
  const [profileConfig, setProfileConfig] = useState<any>({ themeColor: "#8b5cf6", backgroundUrl: "", htmlBox: "" });
  const [roles, setRoles] = useState<{ merchant: boolean; buyer: boolean }>({ merchant: false, buyer: false });
  const filePfpRef = useRef<HTMLInputElement | null>(null);
  const fileBgRef = useRef<HTMLInputElement | null>(null);

  // Ring customization state
  const [showRingModal, setShowRingModal] = useState(false);
  const [activeRing, setActiveRing] = useState<RingPreference>(null);
  const [shops, setShops] = useState<ShopRewardSummary[]>([]);
  const [platformProgress, setPlatformProgress] = useState({ currentLevel: 1, currentXP: 0, xpForCurrentLevel: 0, xpForNextLevel: 100, progressPercent: 0, totalXP: 0, prestige: 0 });
  const [platformPrestige, setPlatformPrestige] = useState(0);
  const [platformArtConfig, setPlatformArtConfig] = useState<SolarSystemConfig | null>(null);
  const [merchantArtConfigs, setMerchantArtConfigs] = useState<Record<string, SolarSystemConfig>>({});
  const [merchantLoyaltyConfigs, setMerchantLoyaltyConfigs] = useState<Record<string, LoyaltyConfig>>({});

  useEffect(() => {
    if (!wallet) return;
    setLoading(true);
    fetch(`/api/users/profile?wallet=${encodeURIComponent(wallet)}`)
      .then(r => r.json())
      .then(j => {
        const p = j?.profile || {};
        setPfpUrl(p.pfpUrl || "");
        setDisplayName(p.displayName || "");
        setBio(p.bio || "");
        setLinks(Array.isArray(p.links) ? p.links : []);
        setXp(Number(p.xp || 0));
        setInterests(Array.isArray(p.interests) ? p.interests : []);
        setContact(p.contact || { showEmail: true, showPhone: false, showLocation: true, showWebsite: true });
        setStatus(p.status || {});
        setRelationship(p.relationship || {});
        setSnapshot({ pfpUrl: p.pfpUrl || "", displayName: p.displayName || "", bio: p.bio || "", links: Array.isArray(p.links) ? p.links : [], interests: Array.isArray(p.interests) ? p.interests : [], contact: p.contact || {}, status: p.status || {}, relationship: p.relationship || {} });
        try { if (p.profileConfig) setProfileConfig(p.profileConfig); } catch { }
        setRoles({ merchant: !!(p.roles?.merchant), buyer: !!(p.roles?.buyer) });
      })
      .finally(() => setLoading(false));
  }, [wallet]);

  // Fetch active ring preference
  useEffect(() => {
    if (!wallet) return;
    fetch(`/api/users/profile/active-ring?wallet=${wallet}`)
      .then(r => r.json())
      .then(data => setActiveRing(data.activeRing || { type: 'platform' }))
      .catch(() => setActiveRing({ type: 'platform' }));
  }, [wallet]);

  // Fetch orders and calculate shop summaries for ring modal
  useEffect(() => {
    if (!wallet) return;

    // Fetch user's orders
    fetch('/api/orders/me', { cache: 'no-store' })
      .then(async r => {
        if (!r.ok) return { ok: false, items: [] };
        const text = await r.text();
        if (!text) return { ok: false, items: [] };
        try { return JSON.parse(text); } catch { return { ok: false, items: [] }; }
      })
      .then(async (data) => {
        // Match RewardsPanel: use data.ok and data.items
        const rawItems = (data.ok && Array.isArray(data.items)) ? data.items : [];
        // Filter out 0-dollar authorizations like RewardsPanel
        const orderList = rawItems.filter((o: any) => o.totalUsd && o.totalUsd > 0);

        // Get unique merchant wallets
        const merchantWallets = [...new Set(orderList.map((o: any) => o.merchantWallet).filter(Boolean))] as string[];

        // Fetch shop configs for each merchant
        const shopConfigPromises = merchantWallets.map(async (merchantWallet: string) => {
          try {
            const res = await fetch('/api/shop/config', { headers: { 'x-wallet': merchantWallet } });
            const configData = await res.json();
            return { merchantWallet, config: configData.config };
          } catch {
            return { merchantWallet, config: null };
          }
        });

        const shopConfigs = await Promise.all(shopConfigPromises);
        const configMap: Record<string, any> = {};
        const artConfigMap: Record<string, SolarSystemConfig> = {};
        const loyaltyConfigMap: Record<string, LoyaltyConfig> = {};

        shopConfigs.forEach(({ merchantWallet, config }) => {
          if (config) {
            configMap[merchantWallet] = config;
            if (config.loyalty?.art) {
              artConfigMap[merchantWallet] = config.loyalty.art;
            }
            if (config.loyalty) {
              loyaltyConfigMap[merchantWallet] = config.loyalty;
            }
          }
        });

        setMerchantArtConfigs(artConfigMap);
        setMerchantLoyaltyConfigs(loyaltyConfigMap);

        // Calculate shop summaries
        const shopMap: Record<string, ShopRewardSummary> = {};
        orderList.forEach((order: any) => {
          const w = order.merchantWallet;
          if (!w) return;
          if (!shopMap[w]) {
            const config = configMap[w];
            shopMap[w] = {
              merchantWallet: w,
              shopSlug: config?.slug,
              shopName: config?.name || `${w.slice(0, 6)}...${w.slice(-4)}`,
              theme: config?.theme,
              totalPoints: 0,
              orderCount: 0,
              lastOrderDate: 0,
              orders: []
            };
          }
          shopMap[w].totalPoints += order.totalUsd || 0;
          shopMap[w].orderCount++;
          if (order.createdAt > shopMap[w].lastOrderDate) {
            shopMap[w].lastOrderDate = order.createdAt;
          }
          shopMap[w].orders.push(order);
        });

        setShops(Object.values(shopMap).sort((a, b) => b.lastOrderDate - a.lastOrderDate));

        // Calculate total platform XP from orders
        const totalOrdersXp = orderList.reduce((sum: number, o: any) => sum + (o.totalUsd || 0), 0);
        const totalXp = Math.max(xp, totalOrdersXp); // Use whichever is higher
        const progress = calculateLevelProgress(totalXp, DEFAULT_LOYALTY_CONFIG);
        setPlatformProgress(progress);
        setPlatformPrestige(progress.prestige);
      })
      .catch(err => {
        console.error('Failed to fetch orders:', err);
      });
  }, [wallet, xp]);

  // Calculate platform progress from XP (initial calculation before orders load)
  useEffect(() => {
    const progress = calculateLevelProgress(xp, DEFAULT_LOYALTY_CONFIG);
    setPlatformProgress(progress);
    setPlatformPrestige(progress.prestige);
  }, [xp]);

  // Save ring preference
  const saveRingPreference = async (ring: RingPreference) => {
    setActiveRing(ring);
    try {
      await fetch('/api/users/profile/active-ring', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeRing: ring })
      });
    } catch (e) {
      console.error('Failed to save ring preference', e);
    }
  };

  // Get ring display properties
  const getRingDisplayProps = () => {
    if (!activeRing || activeRing.type === 'none') {
      return { level: 1, primaryColor: undefined, secondaryColor: undefined, ringText: undefined, ringName: undefined };
    }
    if (activeRing.type === 'merchant' && activeRing.wallet) {
      const shop = shops.find(s => s.merchantWallet === activeRing.wallet);
      if (shop) {
        const progress = calculateLevelProgress(shop.totalPoints, DEFAULT_LOYALTY_CONFIG);
        return {
          level: progress.currentLevel,
          primaryColor: shop.theme?.primaryColor,
          secondaryColor: shop.theme?.secondaryColor,
          ringText: shop.shopName,
          ringName: shop.shopName
        };
      }
    }
    // Platform ring - use user's profile theme color
    return {
      level: platformProgress.currentLevel,
      primaryColor: profileConfig?.themeColor || '#8b5cf6',
      secondaryColor: undefined,
      ringText: undefined,
      ringName: 'Global Platform Ring'
    };
  };

  const ringDisplayProps = getRingDisplayProps();

  async function uploadImage(file: File): Promise<string | null> {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/inventory/images", {
        method: "POST",
        body: fd,
        cache: "no-store",
        headers: { "x-wallet": wallet || "" },
      });
      const j = await r.json().catch(() => ({}));
      const arr = Array.isArray(j?.images) ? j.images : Array.isArray(j?.files) ? j.files : [];
      const first = arr && arr[0];
      const url = first ? (first.url || first) : "";
      return typeof url === "string" && url ? url : null;
    } catch {
      return null;
    }
  }

  async function uploadPfp(file: File): Promise<string | null> {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/users/pfp", {
        method: "POST",
        body: fd,
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      const url = j?.url;
      return typeof url === "string" && url ? url : null;
    } catch {
      return null;
    }
  }

  async function save() {
    if (!wallet) return;
    setSaving(true);
    setMsg("Saving…");
    try {
      const r = await fetch('/api/users/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-wallet': wallet },
        body: JSON.stringify({ pfpUrl, displayName, bio, links, roles, profileConfig, interests, contact, status: { ...status, updatedAt: Date.now() }, relationship })
      });
      const j = await r.json().catch(() => ({}));
      setMsg(j?.ok ? 'Saved!' : 'Failed to save');
      if (j?.ok) {
        setSnapshot({ pfpUrl, displayName, bio, links, interests, contact, status, relationship });
        setEditMode(false);
      }
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 1200);
    }
  }

  function cancelEdits() {
    setPfpUrl(snapshot.pfpUrl || "");
    setDisplayName(snapshot.displayName || "");
    setBio(snapshot.bio || "");
    setLinks(Array.isArray(snapshot.links) ? snapshot.links : []);
    setInterests(Array.isArray(snapshot.interests) ? snapshot.interests : []);
    setContact(snapshot.contact || {});
    setStatus(snapshot.status || {});
    setRelationship(snapshot.relationship || {});
    setEditMode(false);
  }

  if (!wallet) {
    return (
      <div className="w-full h-full">
        <div className="glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] p-6 space-y-4">
          <div className="text-xl font-bold tracking-tight">Connect your wallet to edit your profile.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full p-6 md:p-8 space-y-8 pb-24">
      {/* Hidden file inputs */}
      <input
        ref={filePfpRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          if (f.size > 5 * 1024 * 1024) { setMsg('Profile picture must be ≤ 5 MB'); return; }
          try {
            setUploadBusy(true);
            const url = await uploadPfp(f);
            if (url) setPfpUrl(url);
          } finally {
            setUploadBusy(false);
          }
        }}
      />
      <input
        ref={fileBgRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          if (f.size > 10 * 1024 * 1024) { setMsg('Background image must be ≤ 10 MB'); return; }
          try {
            setUploadBgBusy(true);
            const url = await uploadImage(f);
            if (url) setProfileConfig({ ...profileConfig, backgroundUrl: url });
          } finally {
            setUploadBgBusy(false);
          }
        }}
      />

      <div className="w-full space-y-6">
        {/* Header */}
        <div data-tour="profileSetup.your-identity" className="flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight">Your Profile</h1>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">{loading ? 'Loading…' : msg || ''}</span>
            {!editMode ? (
              <button data-tour="profileSetup.edit-your-profile" onClick={() => setEditMode(true)} className="px-4 py-2 border border-foreground/10 glass-pane rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-foreground/5 transition-colors">
                Edit
              </button>
            ) : (
              <>
                <button onClick={cancelEdits} className="px-4 py-2 border border-foreground/10 glass-pane rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-foreground/5 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-primary/90 transition-colors shadow-sm hover:shadow"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Profile Preview using components */}
        <div className="space-y-6">
          {loading ? (
            <div className="glass-pane rounded-xl border p-6 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-full bg-foreground/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-6 w-48 bg-foreground/10 rounded" />
                  <div className="h-4 w-72 bg-foreground/10 rounded" />
                </div>
              </div>
            </div>
          ) : (
            <>
              <HeroBanner
                backgroundUrl={profileConfig.backgroundUrl}
                editMode={editMode}
                onBgUpload={() => fileBgRef.current?.click()}
              />

              <div className="space-y-4">
                <ProfileHeader
                  pfpUrl={pfpUrl}
                  displayName={displayName}
                  wallet={wallet}
                  xp={xp}
                  statusMood={status?.mood}
                  editMode={editMode}
                  onPfpUpload={() => filePfpRef.current?.click()}
                  showRing={activeRing?.type !== 'none'}
                  ringLevel={ringDisplayProps.level}
                  ringPrimaryColor={ringDisplayProps.primaryColor}
                  ringSecondaryColor={ringDisplayProps.secondaryColor}
                  ringText={ringDisplayProps.ringText}
                  onRingClick={() => setShowRingModal(true)}
                />

                {status?.message && (
                  <StatusSection
                    message={status.message}
                    updatedAt={status.updatedAt}
                  />
                )}
              </div>

              <AboutSection
                bio={bio}
                htmlBox={profileConfig?.htmlBox}
              />

              <InterestsSection interests={interests} />

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                <ContactSection contact={contact} />
                <RelationshipSection relationship={relationship} />
                <LinksSection links={links} />
                <RolesSection merchant={roles.merchant} buyer={roles.buyer} />
              </div>
            </>
          )}
        </div>

        {/* Edit Form with Tabs */}
        {editMode && (
          <EditFormTabs
            displayName={displayName}
            bio={bio}
            pfpUrl={pfpUrl}
            status={status}
            interests={interests}
            contact={contact}
            relationship={relationship}
            links={links}
            roles={roles}
            profileConfig={profileConfig}
            uploadBusy={uploadBusy}
            uploadBgBusy={uploadBgBusy}
            // Ring props
            onOpenRingModal={() => setShowRingModal(true)}
            activeRing={activeRing}
            ringLevel={ringDisplayProps.level}
            ringPrimaryColor={ringDisplayProps.primaryColor}
            ringSecondaryColor={ringDisplayProps.secondaryColor}
            ringText={ringDisplayProps.ringText}
            ringName={ringDisplayProps.ringName}
            onDisplayNameChange={setDisplayName}
            onBioChange={setBio}
            onPfpUrlChange={setPfpUrl}
            onPfpUpload={() => filePfpRef.current?.click()}
            onStatusChange={setStatus}
            onInterestsChange={setInterests}
            onContactChange={setContact}
            onRelationshipChange={setRelationship}
            onLinksChange={setLinks}
            onRolesChange={setRoles}
            onProfileConfigChange={setProfileConfig}
            onBackgroundUpload={() => fileBgRef.current?.click()}
          />
        )}

        {/* Profile Ring Modal */}
        <ProfileRingModal
          isOpen={showRingModal}
          onClose={() => setShowRingModal(false)}
          activeRing={activeRing}
          onSelectRing={saveRingPreference}
          shops={shops}
          userProfile={{ pfpUrl, displayName }}
          platformProgress={platformProgress}
          platformPrestige={platformPrestige}
          platformArtConfig={platformArtConfig}
          platformLoyaltyConfig={DEFAULT_LOYALTY_CONFIG}
          merchantArtConfigs={merchantArtConfigs}
          merchantLoyaltyConfigs={merchantLoyaltyConfigs}
        />
      </div>
    </div>
  );
}
