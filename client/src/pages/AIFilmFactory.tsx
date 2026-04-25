import React, { useState } from "react";

export default function AIFilmFactory() {

  const [text, setText] = useState("");
  const [debug, setDebug] = useState(null);

  async function run() {

    const r = await fetch("/api/jobs?op=wfCreate", {

      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        type: "storyboardToVideo",
        text
      })

    });

    const j = await r.json();

    setDebug(j);

  }

  return (

    <div style={{padding:40,color:"white"}}>

      <h1>AI短片工厂</h1>

      <textarea
        value={text}
        onChange={e=>setText(e.target.value)}
        style={{width:"100%",height:120}}
      />

      <button onClick={run}>
        生成短片
      </button>



    </div>

  )

}
