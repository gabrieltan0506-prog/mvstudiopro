
import React from "react";
import seed from "../data/home_seed_assets_zh.json";

export default function HomeShowcase(){

const items = seed.showcaseImages || [];

return(
<section style={{
maxWidth:1240,
margin:"0 auto",
padding:"60px 20px"
}}>

<h2 style={{
color:"white",
fontSize:34,
fontWeight:900
}}>
精选作品
</h2>

<div style={{
display:"grid",
gridTemplateColumns:"repeat(3,1fr)",
gap:20,
marginTop:30
}}>

{items.map((item,i)=>(
<div key={i}
style={{
borderRadius:20,
overflow:"hidden",
background:"rgba(255,255,255,0.04)",
border:"1px solid rgba(255,255,255,0.08)"
}}
>

<div style={{
height:260,
background:`url(${item.imageUrl}) center/cover`
}}/>

<div style={{padding:18}}>

<div style={{
color:"white",
fontWeight:900,
fontSize:20
}}>
{item.title}
</div>

<div style={{
marginTop:6,
color:"#ff9b75",
fontWeight:700,
fontSize:12
}}>
{item.model}
</div>

</div>
</div>
))}

</div>

</section>
)
}
