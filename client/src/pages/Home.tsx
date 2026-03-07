import React from "react";
import HomeNavbar from "../components/HomeNavbar";
import HomeHero from "../components/HomeHero";
import HomeTools from "../components/HomeTools";
import HomeShowcase from "../components/HomeShowcase";
import HomeWorkflow from "../components/HomeWorkflow";
import HomeCreatorEco from "../components/HomeCreatorEco";
import HomePlans from "../components/HomePlans";

export default function HomePage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top center, rgba(255,79,179,0.12), transparent 18%), radial-gradient(circle at 0% 0%, rgba(139,92,246,0.18), transparent 24%), radial-gradient(circle at 100% 40%, rgba(59,130,246,0.10), transparent 20%), linear-gradient(180deg,#0a0814 0%, #0a0d1f 40%, #090915 100%)",
      }}
    >
      <HomeNavbar />

      <HomeHero />

      <HomeTools />

      <HomeShowcase />

      <HomeWorkflow />

      <HomeCreatorEco />

      <HomePlans />
    </div>
  );
}
