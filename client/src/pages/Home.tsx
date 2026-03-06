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
          "radial-gradient(circle at top center, rgba(255,79,179,0.10), transparent 20%), radial-gradient(circle at left top, rgba(139,92,246,0.16), transparent 26%), linear-gradient(180deg,#0a0814 0%, #090d1d 46%, #090915 100%)",
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
