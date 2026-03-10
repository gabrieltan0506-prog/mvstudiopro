
export async function translateToEnglish(text:string){

  try{

    const r = await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",
      headers:{
        "Authorization":`Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        model:"gpt-4o-mini",
        messages:[
          {role:"system",content:"Translate the following text into concise English prompts for image/video generation."},
          {role:"user",content:text}
        ]
      })
    })

    const j = await r.json()
    return j?.choices?.[0]?.message?.content || text

  }catch(e){
    return text
  }

}
