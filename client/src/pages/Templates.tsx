import { useNavigate } from "react-router-dom";

const templates = [
  {type:"image",prompt:"赛博女偶像电影人像"},
  {type:"video",prompt:"15秒科幻MV预告片"},
  {type:"music",prompt:"电子流行BGM 120秒"}
];

export default function Templates() {
  const nav = useNavigate();
  return (
    <div style={{padding:40}}>
      <h1>模板库</h1>
      {templates.map((t,i)=>(
        <div key={i} style={{margin:20}}>
          <p>{t.prompt}</p>
          <button onClick={()=>nav(`/test-lab?type=${t.type}&prompt=${encodeURIComponent(t.prompt)}`)}>
            做同款
          </button>
        </div>
      ))}
    </div>
  );
}
