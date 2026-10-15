import type { SongCraftReference } from "./songCraftLibrary";

/** 经回执核对的公开作品分析；只含原创方法归纳，不打包原始字幕、歌词或账号路径。 */
export const SONG_CRAFT_NATIVE: readonly SongCraftReference[] = [
  {
    "id": "zuiren",
    "title": "罪人：自我审判与动态递进",
    "contributor": "李克勤演唱；周博贤粤语词及制作；方炯镔曲；Johnny Yim编曲",
    "basis": "native_audio",
    "highlights": [
      "26–93秒：主歌低回叙述，钢琴与逐渐增厚的弦乐承托；把愧疚放在具体关系里，避免开头就喊情绪。",
      "93–157秒：鼓组及弦乐加入，演唱从克制转为更有支撑的高区长句；歌词立场从解释转为承担后果。",
      "157–210秒：编曲收缩后再次蓄势，让第二轮爆发有落差；同一痛点通过新的认知推进。",
      "210–289秒：主唱居中靠前，弦乐横向展开，鼓与低频承托高潮；289秒后回落至钢琴余韵，给情绪收束。"
    ],
    "lyricPrompt": "写一首粤语原创情歌，核心是承认自己的选择伤害了别人，而不是把责任推给爱情。第一人称叙述，故事发生在一间正在清空的旧照相馆。主歌用退回的钥匙、还没取走的雨伞、背面未写完的照片日期呈现关系变化；每段只推进一件事，让日常动作承担情绪。预副歌从辩解转向承认，副歌以一个简短而可唱的自我追问作钩子，末句明确承担失去的后果。第二段加入对方独自收拾残局的细节，避免重复第一段的诉苦。桥段撤掉修辞，用一句平实的话承认无法补偿。结尾不强行复合，留下归还物品的动作。照顾粤语自然语序、声调与旋律可唱性；不借用原曲独有句式、意象组合或旋律。",
    "stylePrompt": "A dramatic Cantonese pop ballad at a slow, steady pace, opening with exposed acoustic piano and a restrained male vocal in a comfortable middle register. Keep the verse intimate, with audible phrasing and enough space between lines. Introduce sustained strings gradually through the build, then bring in a full acoustic drum kit and warm bass for the chorus. Let the melody expand in range without making every line a belt. Pull the arrangement back for the second verse before a stronger final chorus. Place the lead vocal clearly in the center, with strings spread around it and controlled low frequencies. End by stripping the arrangement down to a short piano coda. Use an original melody and a distinct, unimitated voice.",
    "mvPrompt": "以下为原创转译建议，非原MV复述：前奏与主歌以旧照相馆冷色晨光、未取走雨伞和照片背面的空白日期建立缺席；第一次副歌切到归还钥匙却无人应门的固定中景，动作比大哭更重要；第二主歌回到收拾残局的人，让视角补充责任；最终副歌用走廊远景逐渐拉开两人距离，尾奏只留下熄灭的灯。镜头切换服从音乐扩张与回落，避免逐句字幕配图。",
    "sources": [
      {
        "title": "李克勤《罪人》官方MV（HackenLeeVEVO）",
        "url": "https://www.youtube.com/watch?v=BNJlNGB80RE"
      },
      {
        "title": "JOOX《罪人》专辑及制作介绍",
        "url": "https://www.joox.com/mo/album/w2rW1KW61mjI7%2BQaKVGAFQ%3D%3D"
      }
    ],
    "evidence": {
      "taskId": "a4174d90-161d-4dac-82cc-e714a42ee683",
      "actualModel": "gemini-3.8-flash",
      "durationSec": 308,
      "auditNotes": [
        "原始模型署名林若宁词/周博贤编曲错误；蒸馏层按外部署名纠正，原始JSON永久保留。",
        "原始模型68 BPM未有独立测量，已剔除；未独立验证调性、和弦、音高。",
        "原始JSON含模型字幕识别与少量重复，消费层不复述歌词、不当完整歌词库。",
        "时间和声画亮点来自本次原生模型观察，尚未经人工正常速度复核。"
      ]
    }
  },
  {
    "id": "amei-yuanlai",
    "title": "原来你什么都不要：不断退让中的真正需求",
    "contributor": "张惠妹演唱；邬裕康词；郭子曲；李伯杰编曲",
    "basis": "native_audio",
    "highlights": [
      "词作：表面上否定外在赠与，实际是把需求压缩到真实回应；诉求与对方沉默形成落差，不能误读成已彻底放下。",
      "复听修正：前奏与较收敛主歌后，51–98秒进入更丰满的副歌；144–249秒仍含重复副歌、长音与人声发挥，不能把169秒以后全部当作尾奏。",
      "高潮的连续返回可以靠配器密度与演唱措辞推进，不需要每句都加重，也不采用未经测量的两八度或发声生理断言。",
      "复听将尾声细分：249–255秒是歌词主唱结束后的弱尾音过渡，255–282秒以器乐收束，276秒附近进入最后淡出。方法上先完成人声表达，再给器乐留出余韵。"
    ],
    "lyricPrompt": "写一首原创国语抒情歌，写一个人逐步看清自己真正需要什么。第一人称，场景放在即将搬离的合租屋，用交接清单上空着的签名、没有用过的第二把门钥匙、冰箱上过期的约定呈现双方投入不对等。第一段不先责怪，先写主人公如何反复降低要求；预副歌发现自己一直把没有回应解释成对方太忙。副歌用新的简短句式说清一种具体愿望：想要一次认真听完的对话，不以礼物或宏大承诺证明感情。第二段加入一次本可开口却被打断的晚餐，情绪比第一段更诚实。桥段承认想要回应并不可耻，末段决定把期限还给自己，但不强行宣称已经痊愈。用自然语序和长短句对比制造可唱性，不沿用参考歌的排比模板、标志词句、押韵序列或旋律。",
    "stylePrompt": "An original Mandarin pop ballad with an unhurried pulse and a clear emotional build. Start with a sparse keyboard texture and a close, restrained female lead in a comfortable middle register. Leave room for consonants, breath and short silences. Introduce warm bass and a steady drum pattern as the arrangement opens, then widen the chorus with sustained ensemble layers and supporting electric guitar. Let stronger sustained notes answer the intimate phrases instead of turning every line into a climax. Bring the second verse back to a smaller scale while keeping a little rhythmic momentum. Build the final chorus through arrangement and phrasing, then release the tension into a quieter ending. Keep the lead intelligible and centered. Use an original melody, fresh harmonic movement and a distinct voice.",
    "mvPrompt": "原创视觉转译建议，非原MV复述：前奏用合租屋交接清单和第二把钥匙建立未兑现的日常；主歌固定中景看人物把冰箱便签逐张取下，动作犹豫；副歌让人物在空桌两侧换位置，终于完整说出一段无人打断的话，镜头从近景缓慢退开；尾段保留一把钥匙交给房东，人物走向日光，不用暴雨呐喊代替心理转折。具体切点需正式音乐生成后依实际音轨重定。",
    "sources": [
      {
        "title": "官方MV及词曲署名",
        "url": "https://www.youtube.com/watch?v=rT4FqOwn-rs"
      },
      {
        "title": "实体唱片编曲署名",
        "url": "https://www.cdhkonline.com/product-page/張惠妹-姊妹"
      }
    ],
    "evidence": {
      "taskId": "ec6c8432-abbf-4847-8eba-63411258ff29",
      "actualModel": "gemini-3.8-flash",
      "durationSec": 282,
      "auditNotes": [
        "首稿审阅记录：AUDIO与VIDEO回执及原始解析字节SHA已验证，50镜头和7音段全量保留。",
        "首稿曾将169–282秒全部写为尾声，已由同版复听纠正：249–255秒弱尾音过渡，255秒后器乐尾奏。旧错误保留在原始证据中，不再沿用。",
        "首稿审阅记录：原模型编曲屠颖、制作陈复明无支持；消费层编曲纠正为李伯杰，制作人不填。",
        "首稿审阅记录：删除两八度、精确发声机制、walking bass及板式混响等未核实细节；乐器与正常速度听感未人工复核。",
        "首稿审阅记录：对歌词语义按官方文本概述纠偏：仍在要求真实情感回应，非彻底退场；不复制歌词。",
        "第二次同版原生复听已解决尾声起点冲突，纠正区间和新回执见reviewEvidence；原evidence保留首稿事实状态。"
      ]
    }
  },
  {
    "id": "amei-jiemei",
    "title": "姊妹：把亲密关系唱成群体回应",
    "contributor": "张惠妹演唱；张雨生词曲及制作；王继康编曲",
    "basis": "native_audio",
    "highlights": [
      "词作把亲近的人放入季节和自然变化，陪伴通过具体感受累积，再转换为直接呼唤，适合写友情与团聚。",
      "明亮舞曲律动与多人衬词回应交织，独唱承担叙述、群唱扩大情绪空间；这是编制分工，不是把复杂旋律越堆越多。",
      "主歌语气轻巧，副歌放开音量和句尾延展，尾部允许即兴与群唱交接；演唱的快乐感也来自句子轻重和呼吸位置。",
      "张雨生的创作与制作贡献应与亲属合声、编曲分开记录；可提炼“个人经历变成共同庆祝”，不把文化身份变成可复制的异域标签。"
    ],
    "lyricPrompt": "写一首原创国语友情歌曲，写多年后重新聚到一起的四个人。第一段从一条临时改线的公交、一张缺角的合照和一桌有人提前点好的热菜进入，每个人都有不同的生活节奏，却仍记得彼此的习惯。预副歌把叙述从“我记得”转成“我们还会”，让视角自然扩大。副歌用全新的简短呼唤句邀请回应，不复用参考作品的称谓与标志句。第二段写一次没有及时接到的求助电话及后来补上的陪伴，让快乐具有来处，不堆空泛赞美。桥段将伴奏收薄，给两句轮流接唱的空间；最后的副歌由独唱交给小组合唱，允许短促无词回应，但不复制任何民族语言或仪式旋律。结尾用大家一起收桌子的动作落地，保留忙碌生活中的真实情谊。",
    "stylePrompt": "An original joyful Mandarin pop song with a buoyant dance groove, warm syncopated bass and crisp drums. Use bright keyboard accents and rhythmic guitar to make the arrangement move without crowding the words. Begin with a small group of friendly, wordless vocal responses, then bring in a clear female lead for a lightly phrased verse. Let the chorus open into a singalong with layered backing voices answering the lead, keeping each response short and easy to remember. Add playful rhythmic fills between phrases and a little improvised melodic variation near the ending. Keep the energy welcoming rather than aggressive. Reduce the texture briefly before the last chorus so the return feels earned. Compose all vocal motifs afresh; use a distinct voice and no borrowed traditional or ceremonial melody.",
    "mvPrompt": "原创视觉转译建议：前奏从四个不同地点的准备动作交叉剪接，拍带菜、找照片、收伞；主歌沿一条真实街道跟随大家逐渐汇合，以表情和随手帮忙建立关系；副歌环绕同一张饭桌，人物轮流进入镜头回应，避免复刻原MV分屏矩阵；桥段看一人安静洗碗、另一人走来接过毛巾；末段大家收拾桌子走进夜色，动作与鼓点呼应。",
    "sources": [
      {
        "title": "官方MV与张雨生词曲署名",
        "url": "https://www.youtube.com/watch?v=OO60xtWjLRw"
      },
      {
        "title": "实体唱片编曲资料",
        "url": "https://www.cdhkonline.com/product-page/張惠妹-姊妹"
      },
      {
        "title": "制作与家人合声辅助记录",
        "url": "https://musicbrainz.org/release/18226ffa-78d2-4950-bacf-c04c7b3fdfee"
      }
    ],
    "evidence": {
      "taskId": "1f9d0cdb-e532-4444-be23-59488c405bc8",
      "actualModel": "gemini-3.8-flash",
      "durationSec": 264,
      "auditNotes": [
        "32镜头6音段全量保存；结构覆盖264秒且cue均在段内，原始解析相等及SHA通过。",
        "原模型120–125BPM、精确发声机制、slap bass等无独立测量，不带入事实；朋克/放克名称混淆不沿用。",
        "原生模型听辨不等于主代理亲耳听过或用户审片；消费卡不提供未经人工核对的锁秒。",
        "亲属合声与制作署名采用外部资料，未由听辨推断具体身份；提示词不复制原住民语言或仪式旋律。"
      ]
    }
  },
  {
    "id": "nianlun-zhang",
    "title": "年轮（张碧晨）：时间意象与克制后的展开",
    "contributor": "汪苏泷词曲；张碧晨演唱；本版编曲署名待独立核验",
    "basis": "native_audio",
    "highlights": [
      "18–56秒：女声由轻声叙述进入更有张力的推进；词作把漫长等待放进自然物象，演唱负责把抽象时间唱出重量。",
      "56–90秒：伴奏层次变厚、声线进入更高位置；将副歌写成一句重新理解过去的话，比单纯重复悲伤更能支撑动态增长。",
      "90–105秒：器乐间奏暂时接过叙述，让听者消化前一轮情绪；126秒后再次扩张，形成回落与再推进。",
      "本次来源为2015《花千骨》OST官方音频，画面是静态宣传封面；没有可蒸馏的原MV镜头叙事。"
    ],
    "lyricPrompt": "写一首原创中文抒情歌，主题是一个人经过漫长等待，终于发现时间没有替自己做决定。采用第一人称，围绕旧宅门槛上一道逐年褪色的刻痕展开，意象只选木纹、季节、光线三类，形成相互关联的变化，避免堆砌仙侠名词。第一主歌写日常仍照常发生的细节，预副歌让叙述者意识到自己一直把等待误认成承诺；副歌以短句回答“这些年究竟留下了什么”，情绪打开但不用控诉对方。第二段写一次主动搬动旧物的行动，桥段承认不必抹除过去也能离开。末次副歌保留主钩子的节奏位置，却改变结尾的判断，由固守转为自我承担。句子便于换气，长短交替；使用原创物象关系与旋律，不复用参考歌曲的标志句。",
    "stylePrompt": "An original Mandarin ballad with a gentle traditional Chinese color and a measured, flowing pulse. Begin with a breathy woodwind phrase and sparse plucked accompaniment. Introduce an intimate female lead whose verses feel restrained and conversational, with clean diction and space around the line endings. Build the accompaniment in stages rather than making the opening immediately epic. In the chorus, let sustained strings and a grounded rhythm section widen the sound while the vocal rises into a more resonant register. Use a short instrumental interlude to release tension before the second build. Preserve room for a clear lead melody, and let the final section gradually simplify. Avoid excessive ornament, constant belting, artist imitation, and borrowed melodic hooks.",
    "mvPrompt": "原创转译建议，非原片观察：前奏以固定近景拍门槛刻痕，晨光从纹理缓慢移过；主歌让人物整理旧宅，不以歌词逐字配景；第一次副歌打开尘封的窗，光线扩张对应配器展开；间奏只留空房和风动窗帘；最后副歌人物带走一件必要物品，其余留在原处，尾声用空镜完成离开。",
    "sources": [
      {
        "title": "太合分发：张碧晨《年轮》，2015《花千骨》OST",
        "url": "https://www.youtube.com/watch?v=-LUuiPavrvw"
      },
      {
        "title": "Tencent分发：汪苏泷《年轮》词曲署名",
        "url": "https://www.youtube.com/watch?v=qMZRy0Pyghc"
      }
    ],
    "evidence": {
      "taskId": "76479ad8-54df-4fe1-9218-7bb7fbd9f1ff",
      "actualModel": "gemini-3.8-flash",
      "durationSec": 275,
      "auditNotes": [
        "原模型精确68 BPM未经测量已删除。",
        "原模型交响乐/铜管/太鼓等精确配器未经独立确认，消费层仅用弦乐与节奏层次等较宽描述。",
        "时间亮点来自原生模型听辨；尚未人工复听，段落边界不作精确剪辑承诺。",
        "静态封面不是MV；所有镜头为原创转译建议。"
      ]
    }
  },
  {
    "id": "nianlun-wang",
    "title": "年轮（汪苏泷）：气声叙述与副歌层次",
    "contributor": "汪苏泷词曲及演唱；本版编曲署名待核",
    "basis": "native_audio",
    "highlights": [
      "0–32秒：钢琴与弦乐铺设较长前奏；32–68秒人声以轻、近、带气息的方式进入，伴奏让出叙述空间。",
      "68–81秒：弦乐逐步增加厚度；81–134秒鼓、低音与弦乐共同展开，声音由轻述进入更有延展性的副歌。",
      "134–146秒：器乐间奏将上一轮的情绪暂时放下；146–180秒回到叙述，180–228秒再次进入副歌，228秒后以钢琴收束。",
      "这份录音强调柔软的人声起点与后续层次；与张碧晨版的比较应落在演唱、配器和结构处理，不能据此评价相同词曲的优劣。"
    ],
    "lyricPrompt": "写一首原创中文抒情歌，讲一个人整理搬家纸箱时，逐渐承认曾经珍惜的生活已经结束。第一人称，不直接给对方定罪。第一主歌只写胶带、纸箱和窗外天色三类细节，用动作暗示迟疑；预副歌让“再留一晚”的借口显露。副歌以一句简短、可反复吟唱的判断收束：怀念可以保留，生活仍要向前，但自行创作措辞，不引用参考歌。第二主歌出现真正的决定，把一个一直舍不得收起的物件放入箱底；桥段承认自己也曾逃避选择。末次副歌的句式与节奏位置保持稳定，结尾从请求别人回来改为允许自己离开。控制意象数量，给长音留出元音空间，不复用原作的核心自然意象组合或标志句。",
    "stylePrompt": "An original Mandarin pop ballad with an intimate male lead. Open with a spacious piano motif and restrained strings, then bring the voice in softly with audible breath and conversational phrasing. Keep the first verse light, leaving silence at the ends of phrases. Gradually thicken the strings before the chorus; add a grounded bass line and a gentle drum pulse as the melody opens into longer, more resonant notes. Use occasional light-register transitions as expression, without constant vocal ornament. After the first chorus, allow a short instrumental passage to breathe, then rebuild from a quieter second verse. End by stripping back to piano. Prioritize a clear original melody, emotional pacing and natural diction; avoid artist imitation and borrowed hooks.",
    "mvPrompt": "原创转译建议，非原片观察：前奏以纸箱与未封口胶带的细节建立停滞；主歌拍人物反复整理同一件物品，保持近景与静止机位；预副歌逐渐显露空下来的房间；副歌让人物终于把纸箱搬向门口，镜头空间随配器展开；间奏停在窗外暮色；尾声只留下封好的最后一箱。",
    "sources": [
      {
        "title": "WCY Music Studio公开转传：汪苏泷《年轮》，非官方来源",
        "url": "https://www.youtube.com/watch?v=6Q0JC7teW2I"
      },
      {
        "title": "Tencent官方发行元数据：2015汪苏泷《年轮》，当前YouTube不可播",
        "url": "https://www.youtube.com/watch?v=qMZRy0Pyghc"
      }
    ],
    "evidence": {
      "taskId": "7035a08f-2d8f-4e1f-b59e-9202027a44d3",
      "actualModel": "gemini-3.8-flash",
      "durationSec": 246,
      "auditNotes": [
        "实际读取公开第三方转传；时长246秒与官方发行条目一致，未进行音频指纹确认，不冒充官方音源。",
        "删除模型擅写的官方授权翻唱描述、未经测量的精确BPM及过细器乐识别。",
        "时间与声音观察来自原生模型，尚未人工复听，不作精确剪辑承诺。",
        "静态古风CG与歌词动画不当作叙事MV；镜头建议均为原创转译。",
        "503一次后按授权等待18秒，第二次200；503无usage，不推断免费。"
      ]
    }
  },
  {
    "title": "解脱：把情绪困境改写为行动选择",
    "contributor": "张惠妹演唱；姚若龙词；许华强曲及编曲",
    "highlights": [
      "词作先用夜晚与清晨承接失眠，再把反复追问转为承认现实；主副歌的变化是认知变化，不能只用音量解释。",
      "副歌将双方的选择权分开，既允许对方离去，也让自己重新生活；疗愈来自恢复主动性，不是强装快乐。",
      "原生听辨呈现木吉他起势、节奏组逐渐扩张、尾部重新收薄的层次，音乐的打开对应心理空间扩大。",
      "演唱从近距离叙述转向更有支撑的长句，句尾装饰提供情绪延伸；不把发声技术术语当作未经验证的生理结论。"
    ],
    "lyricPrompt": "写一首原创国语歌曲，主题是关系结束后重新安排自己的生活。第一人称，从清晨第一次独自去修自行车写起，用松掉的刹车线、口袋里过期的电影票、手机上删掉又留下的提醒呈现犹疑。第一段允许难过，不急着宣布成长；预副歌问自己为何把每一天都留给一条不会来的消息。副歌以新的动作钩子提出选择：把原本等人的时间用来完成一件真正想做的小事。第二段写出第一次尝试的笨拙和朋友普通的帮助，不把走出来写成突然胜利。桥段承认依然会想起对方，但思念不必决定今天的方向。最后一次副歌保留同样的核心句，替换细节让行动真的发生，收尾停在骑车经过熟悉街口却继续向前的瞬间。避免复用原歌标志性自我定义句、夜城星辰意象组合与旋律。",
    "stylePrompt": "An original Mandarin acoustic pop ballad with a gentle soul influence and a steady, unhurried groove. Open with articulate acoustic guitar and an intimate female vocal, leaving space for natural phrasing. Add a rounded bass line and restrained percussion gradually, letting rhythmic movement suggest determination before the arrangement becomes larger. In the chorus, use a full but controlled drum kit, supportive guitar layers and open sustained chords. Give the lead room to extend key phrases and add a few expressive melodic turns without decorating every syllable. Pull back between major peaks so the final chorus feels like a wider view rather than a louder repetition. Return to a small acoustic texture at the end. Keep the melody original and the vocal identity distinct.",
    "mvPrompt": "原创转译建议：前奏与主歌在普通修车铺观察人物等待、试车和收起旧票根，少量近景承载犹疑；副歌跟拍骑行从狭窄巷口进入开阔河岸，速度保持自然；桥段在旧路口停下但不回头；尾奏沿另一条道路继续骑行。镜头以真实选择对应音乐层次，不复刻原MV的奔跑或舞台段落。",
    "sources": [
      {
        "title": "官方MV及词曲署名",
        "url": "https://www.youtube.com/watch?v=jUMdoUV7VL4"
      },
      {
        "title": "实体唱片编曲资料",
        "url": "https://www.cdhkonline.com/product-page/張惠妹-姊妹"
      }
    ],
    "id": "amei-jietuo",
    "basis": "native_audio",
    "evidence": {
      "taskId": "f853a2e1-d310-4244-b950-426d95be83a6",
      "actualModel": "gemini-3.8-flash",
      "durationSec": 282,
      "auditNotes": [
        "48镜头5音段全量保留，282秒结构覆盖，原始解析相等与SHA通过；秒位是模型观察，未人工常速复核。",
        "首发429原始响应永久保存，等待18秒后第二次成功；无重购成功内容。",
        "移除未测72BPM、具体发声机制、Hammond音色、刷鼓等不确定细节；听辨不是精确音高或混音参数测量。",
        "原模型提示词较短且沿用原MV意象，消费层改写为独立修车和骑行故事，不复制原歌词或镜头。"
      ]
    }
  },
  {
    "id": "weiyi",
    "title": "唯一：私密叙述与直接宣告的距离",
    "contributor": "王力宏词曲及演唱；单曲词曲经Sony官方专辑说明核实",
    "basis": "native_audio",
    "highlights": [
      "0–21秒以钢琴建立核心动机，21秒后人声以较轻的叙述进入；36–45秒近距离演唱画面加强呼吸与表达的亲密感。",
      "约76秒后声线与伴奏动态打开：主歌的犹疑与副歌的直接确认形成表达强度差，而不是不断增加悲伤形容词。",
      "144秒附近模型观察到弦乐演奏细节与节奏呼应，160–175秒高亮逆光把表演空间抽象化；可借鉴声部细节切镜与明暗扩张的对应方式。",
      "225秒后进入收束，钢琴与弦乐余响让最后判断停留；精确段落边界及弦乐奏法尚未人工复听，不能直接作剪辑点。"
    ],
    "lyricPrompt": "写一首原创中文抒情歌，主题是两个长期异地的人约定同看一场天文现象，却始终无法在同一地点相见。第一主歌让叙述者记录两地的日落时差，细节限于钟面、天色和信号断续；不要把距离写成抽象口号。预副歌从对方的沉默产生犹疑，副歌以简短的主动选择回答这份犹疑，表达“愿意靠近，但不要求你证明”，使用完全原创措辞。第二主歌让日程冲突真正发生，桥段承认有些承诺必须靠行动而不是更响的誓言兑现。末次副歌将愿望变成具体出发决定。语句适合先轻声说、再拉长唱，保留句末呼吸与长音位置；避免沿用参考歌标题、标志句或旋律。",
    "stylePrompt": "An original Mandarin piano-led pop ballad. Establish a memorable piano motif before an intimate male lead enters with understated conversational phrasing. Let the verse carry hesitation through pauses and gentle melodic turns. Open the chorus into longer sustained notes and a wider vocal range, supported by expressive strings and a steady acoustic rhythm section. Keep the lead voice clear and emotionally direct. Allow instrumental details to briefly answer the singer between phrases instead of maintaining a constant wall of sound. Make the final chorus feel like a deliberate choice, then reduce the arrangement to piano and lingering string resonance. Avoid artist imitation, borrowed melodies, excessive runs and synthetic orchestral bombast.",
    "mvPrompt": "原创转译建议，非原MV复刻：两个相距很远的天文台由相同钟面动作建立联系。主歌以受限近景拍记录时间、调整望远镜的手势；副歌扩大到两地不同天色的穹顶，人物始终没有同框；器乐过渡用望远镜机械运动呼应伴奏细节；末次副歌拍叙述者走出观测室，主动开始旅程；尾声保留对方仍在等待日出的长镜头。",
    "sources": [
      {
        "title": "王力宏VEVO《唯一》官方MV",
        "url": "https://www.youtube.com/watch?v=P7Qv4AV_StM"
      },
      {
        "title": "Sony《唯一》官方专辑说明与词曲署名",
        "url": "https://sonymusic.com.tw/album/唯一-王力宏-leehom-wang-sdd0128/"
      }
    ],
    "evidence": {
      "taskId": "036cb4b5-4d65-4b99-b20e-e3310c9e894f",
      "actualModel": "gemini-3.8-flash",
      "durationSec": 261,
      "auditNotes": [
        "raw35309与parsed31739字节及SHA均与永久回执一致。",
        "删除未经测量72BPM、精确声部与演唱术语断言。",
        "原模型136–180秒全判间奏，尚未人工复听，不在消费层照搬该段落标签。",
        "原subtitles中有疑似错词，不引用、不修写原始JSON。",
        "时间观察来自原生模型，原创MV方案不是原片观察。"
      ]
    }
  },
  {
    "id": "moshengren",
    "title": "最熟悉的陌生人：关系悖论与中低音叙事",
    "contributor": "姚谦作词；柯肇雷（小柯）作曲；萧亚轩演唱",
    "basis": "native_audio",
    "highlights": [
      "17–46秒的中低音叙述保留柔软气息，伴奏维持稳定律动；亲密感来自克制语气，不能把歌手音色当作词作技巧。",
      "约65秒副歌出现更强的声线与节奏层次；核心关系以两个互相冲突的身份概念并置，将漫长故事压缩成一个悖论。",
      "约143–206秒的情绪推进结合黑白和彩色回忆切换；表演强度、节奏与画面时态共同推动，不单靠加大弦乐音量。",
      "本次为动态MV；模型两处段落标签在91–108秒及206–224秒存在不一致，消费层保留可辨动态变化，不把不一致区间列成精确结构。"
    ],
    "lyricPrompt": "写一首原创都市抒情歌，以第一人称描写两个曾经共同创业的人，分开后在行业颁奖礼重逢。叙述者能熟练说出对方最习惯的答案，却只能用客套称呼开口。第一主歌写胸牌、致辞稿和会场掌声三个细节，表面礼貌，内部失衡；预副歌通过一次下意识替对方解围暴露旧默契。副歌用一组原创、互相冲突的关系定义压缩故事，例如身份已经退场而习惯仍在履职，但自行写成可唱的短句，不借原歌标题表达。第二主歌让双方各自回答别人的提问，桥段承认他们的成长也包含分开。末次副歌从痛感转为清醒的尊重，结束于一次真正属于现在的道别。不要采用搬家、空房、钥匙、海边奔跑等通用伤感布景；保留自然口语和稳定节奏，不仿写原句。",
    "stylePrompt": "An original urban Mandarin ballad with a restrained late-1990s R&B influence. Use a steady, relaxed drum groove, warm bass and soft keyboard voicings as the foundation. Feature a female lead in a warm lower register, with intimate conversational phrasing and subtle breath at the ends of lines. Let rhythmic placement carry tension before increasing volume. Give the chorus a clearer, more open melodic shape, stronger vocal projection and selective string support, while preserving the groove. Make the return to the verse feel emotionally guarded rather than empty. Build the final passage through vocal conviction and rhythmic weight, then withdraw layers gradually. Avoid artist voice cloning, borrowed hooks, excessive belting and a uniformly cinematic piano-string swell.",
    "mvPrompt": "原创转译建议，非原MV复刻：在颁奖礼后台与舞台之间切换，主歌通过胸牌、侧目、整理致辞稿的手部拍旧默契；副歌把两人置于同一宽镜头但分居舞台两端，掌声中没有对视；第二段利用采访画面与真实反应形成公共身份和私人记忆的差别；结尾二人在走廊礼貌道别，各自转入不同的灯光区域，不靠哭喊完成情绪。",
    "sources": [
      {
        "title": "Timeless Music《最熟悉的陌生人》官方MV与词曲署名",
        "url": "https://www.youtube.com/watch?v=C5mI0TqrJ-4"
      }
    ],
    "evidence": {
      "taskId": "e1066107-604f-4e07-960d-9535d3b14144",
      "actualModel": "gemini-3.8-flash",
      "durationSec": 259,
      "auditNotes": [
        "raw38520/parsed34457字节及SHA与永久回执一致。",
        "模型结构与音轨分段不完全一致，未复听，不使用精确段界作剪辑承诺。",
        "删除精确68BPM、Rhodes型号/军鼓等未独立核验细节。",
        "不采用模型接近原标题的副歌建议，改成创业伙伴重逢的关系悖论。",
        "时间听辨来自原生模型，尚未人工复听；原创MV建议不混入原片观察。"
      ]
    }
  },
  {
    "id": "fang-qinghua",
    "title": "青花瓷：物件工艺转成情感关系",
    "contributor": "方文山词；周杰伦曲；周杰伦演唱",
    "basis": "native_audio",
    "highlights": [
      "词作方法：以器物的质地、制作与保存方式组织情感，不只罗列古风词；迁移时需更换物件与人物关系。",
      "0–22秒：定点复听记录明亮弹拨与气流类持续音交织，先建立声音材质，再引入完整伴奏；不把具体乐器猜测当已独立核定。",
      "22–58秒：定点复听记录较轻的人声和伴奏逐步加层，句间保留呼吸；让物件细节先出现，再把情绪展开。",
      "定点复听补充：98–115秒为器乐间奏，115秒第二主歌人声重新进入，伴奏回到较轻的织体；可迁移的是先换材质再回到叙述的对比，而非照搬曲调。"
    ],
    "lyricPrompt": "写一首普通话原创抒情歌词，人物在修复一把旧纸伞时学会容许关系留下缺口。先写手指沿竹骨找裂口、未干浆糊粘住袖口的动作，不一开始就解释悲伤。让修补、绷紧、晾干这些工艺动词逐渐指向人物曾经试图控制的一段关系；物件必须真的被使用，不能只是古风名词装饰。第一段执意恢复原样，较短的叙述句给清亮弹拨留下回答的位置；副歌用新写的简短核心句提出是否一定要完好才值得留下。器乐间奏后，第二段回到柜角伞套与窗边积水，发现对方早就留过一道不同颜色的补缝，改变对过去的理解。后段不突然喊出放下，而是让核心句从追问变成许可；结尾撑开纸伞，承认修补痕迹会透光。保持温柔口语、连贯的工艺意象和可唱气口，不使用青花瓷、釉色、烟雨等标志组合，不复刻参考歌词与旋律。",
    "stylePrompt": "An original Mandarin pop ballad with a gentle R&B pulse and a spacious, unhurried feel. Open with a bright Chinese plucked-string timbre, allowing its short attacks and lingering resonance to establish the atmosphere. Add warm bass, restrained drums and soft sustained strings gradually. Keep the verse conversational and the melody easy to breathe through; let the chorus widen in range and sustain without becoming a power-ballad belt. Use light sliding ornaments and occasional airy upper-register touches in a distinct male voice. Reserve instrumental answers for gaps between vocal phrases. Keep percussion understated and maintain clear separation between the lead and decorative textures. Return to a lighter arrangement for the ending. Compose a new melody and avoid imitating any singer's voice.",
    "mvPrompt": "原创视觉转译，不是原MV复述；剪辑跟新歌实际段落。前奏用近景记录灯下竹骨裂口与指尖试探，弹拨短音对应轻触，不把每一拍都切镜。主歌在同一修伞桌跟完擦拭、刷浆糊、压住旧纸三个动作，窗口反光保留人物表情。副歌第一次展开伞面，主人公发现一道颜色不同的旧补缝，急于揭掉却在纸纤维拉扯时停手。器乐间奏改为窗边积水与伞套的静物镜头，显示时间经过。第二主歌让他沿原补缝重新压平，把自己的修补接在旁边。末次副歌镜头从伞下看见两种纸透光不同，人物走到门口撑开而不遮住补痕；尾声回到空桌，浆糊已干。",
    "sources": [
      {
        "title": "周杰倫 Jay Chou【青花瓷 Blue and White Porcelain】-Official Music Video（周杰倫 Jay Chou）",
        "url": "https://www.youtube.com/watch?v=Z8Mqw0b9ADs"
      }
    ],
    "evidence": {
      "taskId": "d44fd836-1189-4024-855e-99db4b646700",
      "actualModel": "gemini-3.8-flash",
      "durationSec": 243,
      "auditNotes": [
        "时间和音乐观察来自本次原生模型，未独立人工常速审听；方法提示词为原创迁移建议。",
        "未独立测量BPM、调性、和弦和音高；消费层不采用原始模型猜测的精确值。",
        "歌词作者、作曲者、演唱者职责分别记录，不能把整体编曲归于词作者。",
        "原始字幕字段不作为可发布的完整歌词库；消费层只概述方法，不复述歌词。",
        "已完成同版完整原生定点复听并永久保留新旧证据：第二主歌115秒进入在新reusableZh、音轨段落及voice_change三处一致，撤回旧155秒第二主歌。复听对第二副歌150/155秒的修辞仍不一致，该精确入点不采用；不是把整张时间表判为全部核准。",
        "原始MV人物/导演署名、剧情结局及烧瓷气象典故未独立核实，不纳入方法卡事实；MV字段仅为原创转译。"
      ]
    }
  },
  {
    "title": "冲动：用节奏与对话拆开关心和控制",
    "contributor": "张惠妹演唱；于光彦及另一署名待核作者作词；钟兴民曲及编曲",
    "highlights": [
      "歌词把冲突落在追问行踪、拒绝被盘问的对话里，亲密关系的问题通过行为呈现，不靠抽象喊痛。",
      "短句带来问答和顶撞感，副歌把持续累积的压力转成清晰判断；可以借鉴节奏功能，不能把冲突写成无缘由的发怒。",
      "原生听辨呈现较柔的开场和强节奏主体的反差，鼓与贝斯构成推进核心，吉他段落提供器乐回应。",
      "主唱与伴唱交接让同一段旋律有回应关系；演唱力度与乐队密度共同变化，比全程高音更有张力。"
    ],
    "lyricPrompt": "写一首原创国语节奏歌曲，核心是辨认关心与控制的差别。场景是一场朋友聚会后，两个人在楼梯间争论。主歌从被反复追问的定位截图、刚充满又被借去检查的手机、没能讲完的解释写起，句子短而有拍点，不预先给任何一方贴标签。预副歌让主人公先尝试说清自己的感受，再指出每次解释都被当作新的疑点。副歌用一个全新、简明而可回应的句子说出边界，要求尊重而不是证明自己从未犯错。第二段补充对方害怕被抛下的理由，但不把害怕当成控制的正当借口。桥段留下停顿，写两个人终于不抢话的瞬间；最后一次副歌由主人公做出具体选择，结束今晚的争吵并约定清醒时再谈。保留锋利语感与人的复杂性，不照抄参考作品场景、标志句、押韵顺序或旋律。",
    "stylePrompt": "An original Mandarin funk-influenced pop rock song with a firm, danceable rhythm and a conversational edge. Begin with a brief restrained texture before the rhythm section locks into a tighter groove. Use a rounded, active bass line, crisp rhythm guitar and a punchy drum kit, leaving clear spaces for short vocal phrases. Let the female lead alternate controlled, speech-like lines with more open sustained notes in the chorus. Add concise backing-vocal answers instead of a continuous wall of harmony. Give the guitar a short instrumental response after the second chorus, then bring the voices back with increased rhythmic confidence. Build tension through accents, rests and arrangement density rather than an exact tempo jump or nonstop shouting. Use fresh melodies and a distinct vocal identity.",
    "mvPrompt": "原创转译建议：主歌固定在普通住宅楼梯间，通过两人站位逐渐拉开和被打断的话语表现压力；副歌镜头改为侧向跟拍，主人公向楼下走，对方没有追进画面；间奏拍手机从紧握到放进口袋；桥段用长镜头等待双方第一次完整听完一句话，结尾各自走向不同方向。避免复刻原MV俱乐部群舞或频闪舞台。",
    "sources": [
      {
        "title": "官方MV及署名",
        "url": "https://www.youtube.com/watch?v=6nCEpnoVdtA"
      },
      {
        "title": "实体唱片曲目及编曲资料",
        "url": "https://www.cdhkonline.com/product-page/張惠妹-姊妹"
      }
    ],
    "id": "amei-chongdong",
    "basis": "native_audio",
    "evidence": {
      "taskId": "131d8371-b119-4623-9687-ac9c1f1cd5b7",
      "actualModel": "gemini-3.8-flash",
      "durationSec": 254,
      "auditNotes": [
        "31镜头4音段254秒结构覆盖，原始解析相等及SHA通过；未人工听音，不作常速质量通过或锁秒依据。",
        "词作者存在来源冲突：官方MV余致明，实体曲表余玫明；保留冲突，不把模型重复前者当确认。",
        "移除未测115BPM、连续半音、具体发声机制及slap bass等精确断言；MV舞台画面不证明音轨为现场录音。",
        "模型把军鼓/失真吉他同时放入音效栏，蒸馏按音乐乐器处理，不误报环境音；其欢呼声未独立核实。"
      ]
    }
  },
  {
    "id": "youdiantian",
    "title": "有点甜：生活通感与对唱应答",
    "contributor": "汪苏泷词曲；汪苏泷、By2演唱；不把女声误记为无名伴唱",
    "basis": "native_audio",
    "highlights": [
      "18–58秒以轻声叙述与逐渐进入的女声建立交流感；日常物件的感官特征被用来描述心动，使抽象情绪有可触摸的入口。",
      "约58–109秒对唱展开，旋律与轻快节奏让告白更顺口；男女交替和共同唱出的部分承担不同交流功能。",
      "139–165秒的男女声互补延续甜美张力；可转用的是问答、补句、合唱的角色分配，不是克隆任何一位歌手声线。",
      "原MV结合真人表演、方格纸手绘与户外画面；视觉方法是让文字/绘画成为人物互动的一部分，不能把装饰贴纸当成完整叙事。"
    ],
    "lyricPrompt": "写一首原创轻快中文男女对唱，故事发生在两人合作修复一辆旧自行车的下午。A擅长计划却不敢表达，B总把小失误变成笑话。第一主歌A写递错扳手、链条弄脏袖口、车铃忽然响起三个细节；B用另一种解释回应同一事件，形成两个人的视角差。预副歌让互相试探变为共同决定试骑；副歌用简洁、可应答的短句表达“事情未必顺利，有你就愿意再试一次”，自行创作措辞。第二段在小坡上互相等候，桥段给两人各一句坦白，末次副歌由轮唱转为同唱。用触感、动作与声音构成连贯通感，不复用原歌的食物、四季或沙漠意象链，不写宏大永恒誓言。",
    "stylePrompt": "An original bright Mandarin pop duet with a buoyant mid-tempo feel. Use playful piano figures, crisp acoustic-guitar accents, a rounded moving bass line and light punchy drums. Give the male and female leads distinct conversational roles: short solo phrases, answering lines, then a shared hook. Keep the verses nimble and close, with small rhythmic pauses that leave room for a reply. Make the chorus memorable through a clean original melody and interlocking vocal phrases rather than sheer loudness. Add selective harmony on the final refrain, then finish with a brief playful instrumental tag. Keep the sound warm, clear and lightly textured; avoid voice cloning, borrowed hooks, heavy orchestral swells and exaggerated sugary delivery.",
    "mvPrompt": "原创转译建议：一间开放式自行车修理铺，A和B轮流接过工具，每次对唱用动作接力形成镜头应答；副歌从工作台移到试骑小路，车铃成为相互等待的动作提示；间奏用链条和轮辐的运动承接节奏；最后两人骑上小坡，在坡顶同时回头，合唱对应共同选择，而非只拍无目的奔跑。",
    "sources": [
      {
        "title": "汪苏泷官方《有点甜》MV及词曲信息",
        "url": "https://www.youtube.com/watch?v=OtEJ6LGCW-U"
      }
    ],
    "evidence": {
      "taskId": "8772ea50-94bc-4b56-af25-a1396c30b12c",
      "actualModel": "gemini-3.8-flash",
      "durationSec": 229,
      "auditNotes": [
        "raw39973/parsed36240字节及SHA与永久回执一致。",
        "保留By2演唱署名，纠正模型泛称伴唱。",
        "不采用校园民谣标杆等评价断言或未经测量节拍值。",
        "模型快门/翻页音效可能受画面联想影响，未独立复听不入消费层。",
        "时间观察为原生模型结果，尚未人工复听；MV方案全为原创转译。"
      ]
    }
  },
  {
    "id": "putong",
    "title": "普通朋友：吉他律动与声部回应",
    "contributor": "陶喆、娃娃作词；陶喆作曲及演唱",
    "basis": "native_audio",
    "highlights": [
      "0–20秒的吉他动机和轻声吟唱先建立律动与亲密距离；乐器已经能承担节拍感，不必用厚鼓组填满空间。",
      "41–66秒的声线变化与乐句推进增加纠结；词作处理的是双方对关系定义的错位，演唱以停顿、延长和转音让难以说出口的话获得形状。",
      "66–133秒声部层次与主唱装饰变丰富，可借鉴让背景和声回应核心句、主唱保留即兴空间的方法。",
      "214秒后表演与空间构图趋向收束；原模型关于半音阶、转调和精确乐器型号的判断未独立验证，不直接转成硬参数。"
    ],
    "lyricPrompt": "写一首原创中文R&B情歌，第一人称是一位双人舞搭档，在最后一次排练后得知对方即将与别人搭档。叙述者曾把练习中的默契误当成感情承诺。第一主歌写镜墙、节拍器与掌心接触，动作熟练而说话迟缓；预副歌让一句普通的工作安排打破想象。副歌坦白自己暂时还无法若无其事，但尊重对方的选择，不指责对方欠自己爱情。第二段尝试把熟悉的舞步独自完成，桥段承认默契不等于承诺。结尾提出需要一点距离，随后以感谢收住。句子短而有弹性，设计少量重复词给转音和和声回应留空间，不借用原曲的关系标签、英文句子或旋律。",
    "stylePrompt": "An original Mandarin acoustic R&B song built around a supple fingerpicked guitar groove. Let the guitar articulate the pulse with syncopated accents and small melodic answers. Place an intimate male lead close to the listener, using conversational timing, tasteful melisma and occasional light-register transitions. Keep percussion restrained and the bass supportive so the guitar remains audible. Introduce layered backing vocals as responses to the lead, widening selected chorus phrases without covering every line. Build intensity through phrasing, harmony and rhythmic tension rather than orchestral volume. Leave room for a brief guitar-led break, then return to the opening intimacy. Use original chord movement and melody; avoid artist imitation, borrowed riffs and excessive vocal decoration.",
    "mvPrompt": "原创转译建议：在真实舞蹈排练厅中拍一场结束后的独练。主歌以镜墙反射让两人的动作曾经重合，预副歌切回只有一人的实景；副歌让人物继续完成需要搭档的舞步，留空的位置表达失落；声部回应时用过去排练的短动作插入而不重演完整回忆；尾声人物重新设置节拍器，以适合独舞的新动作结束。",
    "sources": [
      {
        "title": "Timeless Music《普通朋友》官方MV",
        "url": "https://www.youtube.com/watch?v=3L3Me4JXVqE"
      },
      {
        "title": "LINE MUSIC《普通朋友》词曲署名",
        "url": "https://music-tw.line.me/track/1000324005"
      }
    ],
    "evidence": {
      "taskId": "afa16d0d-ae01-44c3-900c-3de0308840eb",
      "actualModel": "gemini-3.8-flash",
      "auditNotes": [
        "raw40034/parsed36212字节及SHA与永久回执一致。",
        "删除无测量78BPM、808/Rhodes指定、半音爬升与转调断言及未核导演署名。",
        "模型脚步、风、电梯等声音可能由画面联想，未独立复听不入消费层。",
        "原创词稿不沿用模型将拒绝描写成残忍推脱的判断，保留边界与自我觉察。",
        "原生模型时间观察尚未人工复听；原创MV不冒充原片。"
      ],
      "durationSec": 252
    }
  },
  {
    "id": "amei-shuilan",
    "title": "水蓝色眼泪：冷色内省与摇滚释放的反差",
    "contributor": "张惠妹演唱；张雨生词曲；钟兴民编曲",
    "basis": "native_audio",
    "highlights": [
      "词作将情绪凝聚为有色彩与触感的核心意象，内在感受得到可感知的形状；学习方法是建立意象逻辑，不沿用原歌的标题意象。",
      "复听修正：99–118秒有第二段主歌人声，不是原稿所称吉他独奏；实际器乐间奏识别为158–198秒。把器乐当作叙述回应时，应先确认人声是否真正让出了空间。",
      "215秒以后音乐并未结束：198–280秒仍包含副歌返回和人声延展，280–335秒进入尾段与淡出，约320秒以后伴奏明显渐弱。长曲的后段可以继续发展主题，而非被一笔归入尾奏。",
      "复听将整体收敛为流行抒情摇滚；方法卡采用主歌较轻、后段伴奏与人声扩张的层次，不把它包装成已验证的纯硬摇滚或具体发声技术。"
    ],
    "lyricPrompt": "写一首原创国语流行摇滚歌曲，主题是长期把自己表现得可靠的人终于承认疲惫。第一人称，故事放在一家即将关门的照相馆；主歌观察显影盘边的水痕、倒着放的合影和磨损的放大镜，主人公替别人修复照片却一直避开自己的那一张。选用“失焦的轮廓”作为新的核心意象，让看不清既是视觉细节也是情绪防御，不借用参考作品的色彩眼泪意象。预副歌把每次推迟面对自己串起来，短句逐渐拉长。副歌不宣布毁灭，而是要求停下来、允许自己的脆弱被看见。第二段写一位客人认出照片里的人，迫使主人公停止借工作逃避。桥段保留器乐空间，最后副歌更换一个关键动作：把自己的照片也挂到晾片线上。语言克制而有力量，不复用原词、独特比喻组合、押韵结构或旋律。",
    "stylePrompt": "An original Mandarin pop-rock ballad with a steady pulse and a gradual expansion in arrangement. Begin with a spacious keyboard texture, a contained rhythm section and a close female lead. Let the verse communicate the story clearly, then strengthen the bass and drums as the chorus opens. Use supportive electric-guitar layers without making constant heavy distortion the defining feature. Give a melodic instrumental interlude room to answer the vocal before the final sequence of returning choruses. Develop the later section through fresh phrasing and occasional vocal responses, keeping the lyric intelligible. Allow the closing refrain and band to fade gradually rather than treating the entire last section as a wordless solo. Create new melodies, motifs and a distinct vocal character.",
    "mvPrompt": "原创视觉转译建议，输入只有官方专辑音频，不声称有原MV：前奏与主歌在照相馆暗房中以慢推和手部近景看人物处理别人的照片；副歌打开白灯，之前被藏起的个人照片第一次完整进入画面；器乐间奏跟随照片在水中缓缓显影，避免用虚构事件代替音乐；尾段把照片挂上晾线，人物不再遮挡镜头。时间安排须依未来原创音乐重新确定。",
    "sources": [
      {
        "title": "原专辑官方音频",
        "url": "https://www.youtube.com/watch?v=j9FXY24wyXg"
      },
      {
        "title": "厂牌Topic张雨生词曲署名",
        "url": "https://www.youtube.com/watch?v=2cUaz8AymuI"
      },
      {
        "title": "实体唱片钟兴民编曲署名",
        "url": "https://www.cdhkonline.com/product-page/張惠妹-姊妹"
      }
    ],
    "evidence": {
      "taskId": "dd136fd3-5209-4723-b92b-72eae5b4db7c",
      "actualModel": "gemini-3.8-flash",
      "durationSec": 335,
      "auditNotes": [
        "首稿审阅记录：第二次STOP；首次429原始独立永久保存。34结构项与6音段335秒完整保留，raw/parsed相等SHA通过。",
        "首稿审阅记录：重大时间冲突：正文尾声结束写3:35而实际5:35，且多处段落边界与音轨表不一致；消费卡删除全部秒位，不能用于剪辑锁秒。",
        "首稿审阅记录：原模型将编曲称张雨生，按实体资料纠正钟兴民；不采纳超前理念/里程碑/顶级等无证据评价。",
        "首稿审阅记录：Topic输入为封面音频；模型声称卡拉OK逐字字幕未经独立确认，不采纳视觉细节，也不把34项当34个真实动态镜头。",
        "首稿审阅记录：原模型生成建议直接带原曲标题意象，消费层已完全重写；删除精确BPM、发声生理与未验证乐器细节。未人工听音。",
        "第二次同版原生复听已补齐215–335秒并纠正solo秒位与风格过强标签；新回执和逐项比较见reviewEvidence，首稿证据未覆盖。"
      ]
    }
  },
  {
    "id": "amei-beipan",
    "title": "背叛：把反复怀疑收束成关系底线",
    "contributor": "张惠妹演唱；胡如虹词；吴大卫曲；王继康编曲",
    "basis": "native_audio",
    "highlights": [
      "词作从独处需求写到对关系的怀疑，再提出不可退让的原则；变化不在事件越来越惨，而在说话者逐渐清楚自己的立场。",
      "副歌的简短判断与主歌的追问形成语气差异，适合用重复建立底线，但重复时要让情绪和认识有所推进。",
      "复听修正：147–194秒为器乐间奏，194–222秒仍有完整主歌，222–252秒是后段副歌；不能把152秒以后视为失去固定唱词的即兴。",
      "复听将尾奏收敛为252–273秒约21秒的重复副歌、即兴回应与淡出；主要伴奏识别为键盘、合成器和常规节奏组，撤回突出铜管与吉他独奏的断言。创作上可用短尾奏延伸核心情绪，避免不必要的超长独奏。"
    ],
    "lyricPrompt": "写一首原创国语歌曲，叙述者刚发现一位亲近的人隐瞒了一件重要事实。把故事放在共同经营的小书店：登记本上被涂掉的日期、寄给陌生地址的包裹和已经换过的备用锁构成线索。主歌先承认自己仍有疑问，不急于给人定罪；预副歌写出对方解释与实际行动的距离，让追问越来越具体。副歌不是重复控诉，而是说清一个新的关系原则：共同生活需要可以面对的事实。第二段让叙述者检视自己曾经不愿听见的提醒，保留复杂性。桥段暂停争论，提出一次把话说全的机会；最后的副歌无论是否复合都拒绝再用模糊保证换取信任。短句钩子要原创、自然可唱，避免沿用原歌否定句模板、标志词组、性别概括或旋律。结尾以把账本平放到桌面上的动作结束。",
    "stylePrompt": "An original Mandarin pop song with a clear, steady groove and a firm but reflective emotional tone. Open with a brief vocal response over a compact keyboard-and-rhythm-section texture, then make room for a conversational verse. Use supportive bass and defined drum accents to keep the phrasing active. Let the chorus gain weight through stronger vocal articulation and broader accompaniment while maintaining an intelligible central hook. Place an instrumental passage between the main vocal cycles, led by a simple keyboard melody and sustained supporting layers rather than a featured brass or guitar solo. Return to a complete lyrical passage before the final chorus. Close with a brief continuation of the refrain and a few restrained vocal responses as the band fades. Use new melodies and a distinct vocal identity.",
    "mvPrompt": "原创视觉转译建议，非原MV观察：前奏跟随一件退回书店的包裹；主歌拍账本日期和人物核对事实的动作，以两人隔着书架的空间表现信息距离；副歌移到同一张桌前，镜头保持稳定让完整表达成为行动；器乐段拍书店打烊，最后把账本放在灯下等对方回答，不靠摔杯或火焰表达背叛。",
    "sources": [
      {
        "title": "官方原专辑音频",
        "url": "https://www.youtube.com/watch?v=Lfx_G5K7tuo"
      },
      {
        "title": "厂牌Topic词曲署名",
        "url": "https://www.youtube.com/watch?v=ZXqxe18nJRI"
      },
      {
        "title": "实体唱片编曲资料",
        "url": "https://www.cdhkonline.com/product-page/張惠妹-姊妹"
      },
      {
        "title": "词义交叉核对，未转载歌词",
        "url": "https://www.mulanci.org/lyric/sl149990/"
      }
    ],
    "evidence": {
      "taskId": "d05a651b-c02d-4d1d-b216-6ea46b416303",
      "actualModel": "gemini-3.8-flash",
      "durationSec": 273,
      "auditNotes": [
        "首稿审阅记录：29结构项与4音段273秒保存完整，raw/parsed相等及SHA通过；输入仅静态封面，29项不代表动态镜头。",
        "首稿审阅记录：原模型错误署名邬裕康/黄舒骏/张雨生，按厂牌与实体资料纠正胡如虹词、吴大卫曲、王继康编曲；未核制作人不填写。",
        "首稿审阅记录：模型称近两分钟纯即兴尾奏，尚未人工复核，不在卡片确认为真实时长；删除95–100BPM、换声点/喉位及精确唱腔机制。",
        "首稿审阅记录：内容质量属部分核对：广义动态线索可作创作启发，不能把模型演奏/混音细节当测量值或正式听感验收。",
        "第二次同版原生复听已纠正121秒尾奏与突出铜管/吉他solo说法；具体边界、新证据及方法修改见reviewEvidence，保留首稿原始证据。"
      ]
    }
  },
  {
    "id": "fang-juhua",
    "title": "菊花台：景物变化承接无法挽回的情绪",
    "contributor": "方文山词；周杰伦曲；周杰伦演唱",
    "basis": "native_audio",
    "highlights": [
      "词作方法：让景物和物件的变化承担人物处境，再让副歌扩大到无法挽回的情感后果；不把古典词汇堆砌等同于古典气质。",
      "定点复听记录36秒人声进入、81秒弦乐加厚：较轻的人声与逐渐增长的持续音织体形成对比，让叙述先于高潮。",
      "同版定点复听将首副歌记在94秒，区别于81秒加层与91秒过渡句尾；可迁移的是把配器蓄势与核心句进入分开设计。",
      "定点复听记录最后人声在278秒消散、器乐继续衰减至291秒后静默；原始画面中的刀剑、军号不应直接写成音乐或音效指令。"
    ],
    "lyricPrompt": "写一首普通话原创抒情歌词：多年后回到即将拆除的旧戏院，徒弟向已离开的师父告别。前段从掉漆椅背、舞台木屑和旧节目单里选两样，让人物擦座位、抬头找灯、摸到落幕绳结，先呈现物件和动作，不直接说明谁辜负了谁。较慢的长句留出呼吸，景物的变化逐步透露此地再也无法复原。副歌用新写的简短核心句表达来迟的告别，但避免帝王、战争或宏大命运比喻；把痛感放在一个没有得到回应的动作里。间奏后，第二段让徒弟发现节目单背面留下的排练批注，原本追问为何把自己留下，转为理解师父曾把未做完的工作交给自己。后段只改变核心句里的一个行动方向，让承诺从等待归来变成走出去继续做事。结尾拿走节目单，把椅子摆正，走到街上念第一句台词。不要把形容词堆成悲壮感，不复刻原曲宫廷、菊花、征战意象或原词旋律。",
    "stylePrompt": "An original Mandarin orchestral folk-pop ballad with a slow, steady flow and restrained sorrow. Establish emotional weight through soft plucked accents, low sustained tones and space between phrases, without overloading the introduction. Bring in a clear, intimate male lead above delicate acoustic-guitar figures. Keep the early verse light, then thicken the string texture gradually before the main chorus phrase arrives. Separate the buildup from the actual emotional arrival. Open the chorus into longer melodic lines, keeping the words articulate and the voice controlled. Use an instrumental passage to change the balance between short attacks and sustained resonance before returning to the vocal. Let the final sung phrase finish while the instrumental tail continues to recede. Write a new melody, avoid battle sound effects and use an individual vocal character.",
    "mvPrompt": "原创视觉转译，不是原MV观察；镜头依新歌真实段落排。低音器乐前奏用远景保留戏院入口与拆除告示，人物站门外先不进入。主歌跟他用手擦去椅背灰尘，再沿座位走到台前，木屑粘上鞋底。首次副歌只做一次缓慢推近：他握住落幕绳结却发现绳子已经不连着幕布，让缺失通过动作显现，不加战斗画面或音效。器乐间奏转为舞台侧光下旧节目单背面的折痕，不展示参考歌词。第二主歌他翻到师父的排练批注，重新站到台口，试着完成一个曾没做好的谢幕动作。末段配器变满时，他把松散节目单整理带走、将椅子推回原处；尾声从街外看他离开旧戏院，口型只对应新写且已确认的台词。",
    "sources": [
      {
        "title": "周杰倫 Jay Chou【菊花台 Chrysanthemum Terrace】-Official Music Video（周杰倫 Jay Chou）",
        "url": "https://www.youtube.com/watch?v=PdjbRvvJAzg"
      }
    ],
    "evidence": {
      "taskId": "fa2f84df-d345-43ad-8844-2eb67b96adc9",
      "actualModel": "gemini-3.8-flash",
      "durationSec": 295,
      "auditNotes": [
        "时间和音乐观察来自本次原生模型，未独立人工常速审听；方法提示词为原创迁移建议。",
        "未独立测量BPM、调性、和弦和音高；消费层不采用原始模型猜测的精确值。",
        "歌词作者、作曲者、演唱者职责分别记录，不能把整体编曲归于词作者。",
        "原始字幕字段不作为可发布的完整歌词库；消费层只概述方法，不复述歌词。",
        "本卡已用同原URL、295秒完整定点复听更新94/278/291秒事件；新旧原始与解析证据独立永久保留，事件是原生模型复听结论，不冒充人工听审。",
        "首副歌旧81/91秒结论撤回；81秒现记为弦乐加层，91秒现记为过渡句尾。原战斗画面拟音不采纳，新稿明确未听到独立刀剑/军号。",
        "新旧前奏主导音色不同，新稿又有纯混音与水波微响字段不一致；故style使用原创可执行编制设计，不宣称精确复刻参考配器，仍有上述音乐细项未决。",
        "原首读503无usage，首读与本次复听成功估价均不包含那次失败未知金额。"
      ]
    }
  },
  {
    "id": "amei-aidao",
    "title": "爱到不能收：明知受伤却仍难抽身的内心拉扯",
    "contributor": "张惠妹演唱；王中言词；许华强曲；何国杰编曲",
    "basis": "native_audio",
    "highlights": [
      "词作把矛盾放在知道与做到之间：已经看见关系的伤害，却仍无法停止等待，情绪因此有持续张力。",
      "重复核心诉求时交替呈现宽容对方与亏欠自己的认识，重复句可以承担自我反驳，而非只用于记忆钩子。",
      "原生听辨描述吉他较轻的开场与后续节奏组、持续音层次逐渐增厚，伴奏扩张承接情绪积累。",
      "较收敛叙述与较强的长句演唱形成反差，器乐段暂时接过表达；不能把音量提升自动解释为已经释怀。"
    ],
    "lyricPrompt": "写一首原创国语抒情歌曲，主题是一个人理解关系不再健康，却还没有真正离开的能力。第一人称，故事发生在两人共同照料的小阳台：定时浇水的提醒还在响，一盆已经枯萎的植物仍占着最亮的位置。主歌通过剪掉枯叶又把花盆放回原处，写明知无效仍重复的习惯，不直接评价自己愚蠢。预副歌让理性说出事实，但让最后一个动作暴露不舍。副歌用一个原创、具体的动作句表达矛盾，不照抄参考歌标题结构。第二段加入朋友带来一盆新苗，主人公先拒绝又留下，情绪缓慢移动。桥段承认离开需要练习，不强迫突然变得决绝。最后副歌只完成一个小改变：给新苗腾出位置。结尾保留未解决的感受，避免把忍受伤害浪漫化，也不把复杂关系压成简单口号；不用原词、标志性比喻或旋律。",
    "stylePrompt": "An original Mandarin pop ballad with a patient, emotional build and a grounded rhythm section. Start with a gentle guitar pattern and a close female vocal, allowing small pauses to expose uncertainty. Add warm bass, soft keyboard support and restrained drums as the verse develops. In the chorus, broaden the accompaniment with sustained textures and expressive guitar layers while giving the voice longer phrases to carry. Keep the melody singable and let recurring lines change in emphasis instead of simply increasing volume each time. Use a short instrumental passage to prolong the unresolved feeling, followed by a bridge that briefly reduces the density. The final chorus should feel more honest rather than completely triumphant. Finish with a gradual release, an original melody and an unimitated vocal character.",
    "mvPrompt": "原创视觉转译建议，非原MV观察：主歌在阳台用固定机位记录浇水、剪枯叶和放回花盆的重复；副歌稍微扩大景别，让空置的另一张椅子进入画面；器乐段拍主人公迟疑地接过新苗，桥段保留一个不剪断的停顿；尾声只移动旧花盆给新苗让出光线，不用暴雨或呐喊代替心理变化。",
    "sources": [
      {
        "title": "官方原专辑音频",
        "url": "https://www.youtube.com/watch?v=V5ikFXM8wO4"
      },
      {
        "title": "JOOX词曲与词义核对",
        "url": "https://www.joox.com/mo/single/4RSbnEE0C6Y17A29fFcFOA%3D%3D"
      },
      {
        "title": "实体唱片编曲署名",
        "url": "https://www.cdhkonline.com/product-page/張惠妹-姊妹"
      }
    ],
    "evidence": {
      "taskId": "ffb11a0e-f72e-41db-885b-0d5d775db1ff",
      "actualModel": "gemini-3.8-flash",
      "auditNotes": [
        "32结构项6音段313秒保存完整，raw/parsed相等及SHA通过；静态封面不作真实动态镜头。",
        "模型称卡拉OK滚屏字幕未独立确认，不采纳视觉细节；正文与音轨表尾段边界不完全一致，不提供剪辑秒位。",
        "删除68–72BPM、跨八度、高位置混声、总线压缩等未测断言；音乐建议为原创方向，不是原录音工程参数。",
        "词义核对后保留难以抽身的矛盾，不沿模型提示词把它改成彻底决裂或美化受伤。未人工常速听音。"
      ],
      "durationSec": 313
    }
  },
  {
    "id": "amei-renzhen",
    "title": "认真：用改变自己的小习惯写出依附",
    "contributor": "张惠妹演唱；张方露词；陈志远曲；王继康编曲",
    "basis": "native_audio",
    "highlights": [
      "词作通过为对方改变习惯、缩小社交和等待回应表现自我退让，小动作比直接说失去自我更具体。",
      "叙述先追问自己为何如此顺从，再承认投入与结果并不对等；价值在于自省的复杂性，不应简化成已彻底走出来。",
      "复听修正：104–120秒为器乐过渡，120秒后人声重新进入，186–231秒是末段副歌返回，231–262秒才是器乐尾奏；约245秒开始最终淡出。旧02:62非法时码及被压缩的后段已替换。",
      "主歌到副歌更有推动感，复听归因为配器密度与人声力度增加，没有支持实际tempo加快的证据。创作时保持稳定节拍，利用声部进入与乐句强弱塑造推进。"
    ],
    "lyricPrompt": "写一首原创国语抒情歌，叙述一个人发现自己为了维持亲密关系，慢慢把个人偏好藏了起来。场景是一间正在重新布置的厨房：收藏的辣酱长期没有打开，喜欢的旧杯子被放到柜子最上层，原本周末做面包的习惯变成陪别人赶行程。主歌只写这些小变化，让听者自己看见迁就。预副歌问自己这些选择里还有多少出于喜欢，避免把责任全部推给对方。副歌承认曾经认真投入，同时希望重新拥有说出不同意见的空间。第二段写第一次做回喜欢的早餐时既轻松又心虚的感受。桥段不急着决定分开或复合，而是练习提出一个小请求。结尾让旧杯子重新放到伸手能拿到的位置，以真实动作完成有限而可信的改变。不复用参考歌的梳发、电话、回家等细节组合、标志句或旋律。",
    "stylePrompt": "An original Mandarin pop ballad built around intimate storytelling, a stable pulse and a gradual expansion of the band. Use a gentle keyboard texture, supportive bass and a restrained drum pattern beneath a clear female lead. Keep the first verse conversational, with small pauses that let a thought remain unresolved. As the chorus arrives, broaden the arrangement and allow longer melodic phrases without accelerating the tempo or turning every word into a belt. Give a short instrumental passage room to connect the vocal sections. Develop the final chorus through phrasing and selective backing voices, then let the lead finish before the instrumental ending gradually fades. Preserve a feeling of reflection and unfinished understanding. All melodies, lyric rhythms and vocal character should be newly created.",
    "mvPrompt": "原创视觉转译建议，输入为封面音频：主歌沿厨房动作观察人物拿错杯子、收回辣酱和取消闹钟，不拍解释性闪回；副歌让人物第一次坐到自己喜欢的位置，镜头从局部放开到完整房间；桥段拍犹豫后发出一条简短请求，结尾把旧杯子放回桌面。视觉强调微小自主，不采用奔跑天桥或海边解脱模板。",
    "sources": [
      {
        "title": "官方原专辑音频",
        "url": "https://www.youtube.com/watch?v=5O4N18Njhb4"
      },
      {
        "title": "JOOX词曲及词义核对",
        "url": "https://www.joox.com/mo/single/fh%2BcYZ6gjI9CPEyEVdHVoA%3D%3D"
      },
      {
        "title": "LINE MUSIC词曲署名",
        "url": "https://music-tw.line.me/track/7794235009"
      },
      {
        "title": "实体唱片编曲资料",
        "url": "https://www.cdhkonline.com/product-page/張惠妹-姊妹"
      }
    ],
    "evidence": {
      "taskId": "f7a5b711-ba08-4f46-8263-0645e965fb9d",
      "actualModel": "gemini-3.8-flash",
      "durationSec": 262,
      "auditNotes": [
        "首稿审阅记录：30结构项5音段262秒保存完整，raw/parsed相等及SHA通过；不是30个实拍镜头。",
        "首稿审阅记录：模型误报张雨生词曲，按厂牌Topic/LINE MUSIC/JOOX纠正张方露词、陈志远曲，实体资料王继康编曲。",
        "首稿审阅记录：正文出现02:62非法分钟秒格式且总时长叙述混乱；消费卡删除全部时间，不把结构覆盖等同时间质量通过。",
        "首稿审阅记录：模型把梳直头发解读成发丝纠缠隐喻，消费层按词义纠正为为他人改变自身习惯；不把音量提升解读成彻底释怀。",
        "首稿审阅记录：静态封面卡拉OK字幕未独立确认，不采纳；精确唱腔生理/母带温暖等未验证断言剔除。未人工听音。",
        "第二次同版原生复听已重建262秒后段并纠正tempo与密度混淆；新秒位/回执/方法更新见reviewEvidence，原首稿证据保留。"
      ]
    }
  },
  {
    "id": "huaheart",
    "title": "画心（2015现场）：无字吟唱与后段能量转换",
    "contributor": "陈少琪作词；藤原育郎作曲；张靓颖演唱；现场编配未独立核名",
    "basis": "native_audio",
    "highlights": [
      "18–55秒以无字吟唱而非密集歌词建立情绪空间；69秒附近进入有词叙述，长前奏给人声本身留下成为主题的机会。",
      "约69–180秒以较轻的人声表达维持长线条；听感上的细腻来自音量、气息与句尾控制，不宜用一句“空灵”替代具体安排。",
      "约308秒后节奏力度明显增加，约338–341秒出现高音段；音轨分段、keyMoments与对应镜头均指向后段能量释放。",
      "原生摘要却把228–359秒标成尾声，与上述证据冲突；已排除该摘要段界，整曲精确结构仍待人工复听。本条研究仅针对2015演唱会版本。"
    ],
    "lyricPrompt": "写一首原创中文戏剧性抒情歌，故事是一位修复壁画的人，反复试图还原记忆中一张面孔，却逐渐承认真正想挽回的是当时的自己。开场允许一段无字吟唱，先让旋律表达无法命名的感受。第一主歌只写颜料、裂纹和灯下手势，不解释人物前史；副歌通过三次不同角度的追问，逐步从“你去了哪里”转向“我为何不愿承认变化”，具体句子重新创作。第二主歌修复过程遭遇缺失的图案，桥段停止替空白编造答案。最后一轮不宣称彻底忘记，而选择保留一块未补的空白。字句兼具口语可唱性与少量材质意象，别用魂魄、骨骼、桃花等原作意象组合，不照搬旋律。",
    "stylePrompt": "An original dramatic Mandarin orchestral-pop ballad designed for a live stage. Begin with a spacious wordless female vocalise over sustained atmospheric accompaniment. Keep the first lyrical section restrained, with clear diction and long connected phrases. Allow the wordless motif to return in a changed emotional role. Reserve a stronger rhythmic band entrance for a later section, creating a distinct shift in energy rather than a continuous crescendo. Support the final passage with broad strings and live drums while keeping the lead melody clear. An optional brief upper-register flourish should serve the climax without imitating any singer or demanding extreme pitch. Avoid borrowed vocal motifs, preset BPM claims and nonstop theatrical belting.",
    "mvPrompt": "原创转译建议：一座壁画修复工坊随音乐展开。无字开场只拍颜料在水中散开；主歌以手部近景拍修复裂纹，人物的脸在反光中偶尔出现；后段节奏进入时转为真实大幅度工作动作与宽阔墙面，不用满屏特效代替行动；最后保留壁画中一块空白，人物关掉工作灯，观众自己理解她的决定。",
    "sources": [
      {
        "title": "大长城发布：张靓颖《画心》2015演唱会",
        "url": "https://www.youtube.com/watch?v=meQcB9Jv-fc"
      },
      {
        "title": "JOOX《画心 Live》词曲署名",
        "url": "https://www.joox.com/my-en/single/cIqdxiMb865OTnQw_zG4%2BA%3D%3D"
      }
    ],
    "evidence": {
      "taskId": "12bbe71b-7354-4e78-92a9-60cab26d4ff4",
      "actualModel": "gemini-3.8-flash",
      "auditNotes": [
        "raw39634/parsed36045字节及SHA核对一致。",
        "模型结构摘要228–359秒尾声与308秒后鼓组/340秒高音冲突；采用音轨、keyMoments、镜头共同指向的局部观察，仍未人工复听。",
        "删除68–72 BPM、古筝/失真贝斯等无独立支持断言。",
        "超高音只记录模型所见听感，不断言具体音高/声区生理机制，也不把演唱会编配当原录音编曲。"
      ],
      "durationSec": 359
    }
  },
  {
    "id": "jianai",
    "title": "剪爱：由承受走向主动决定的动词线",
    "contributor": "林秋离作词；涂惠源作曲；张惠妹演唱；专辑制作分工见《姊妹》专辑研究",
    "basis": "native_audio",
    "highlights": [
      "28–77秒的主歌与推进段先保持克制，词意由承受关系变化逐渐转向主动处理感受；可以学习动词职责如何变化，而非替换原作标志性动作词。",
      "77–114秒声线投射和伴奏动态展开，明确的语义决定有了演唱上的重量；不要把高音本身当作剧情转折。",
      "114–138秒器乐过渡暂时接替人声，随后再进入第二轮表达；原模型对具体管乐识别摇摆，不采用萨克斯/双簧管的确定结论。",
      "182–235秒模型记录第二轮更强的演唱，235秒后收束；画面交替表演空间与海岸形象。本条不把全部词曲与编曲归给专辑制作人张雨生。"
    ],
    "lyricPrompt": "写一首原创中文情绪抒情歌，第一人称是一位摄影师，决定停止为一段结束的关系挑选最完美的证据。第一主歌从反复调整一张合照的亮度写起，只使用底片、曝光和取景这组相连意象；预副歌意识到自己一直把画面外的争执裁掉。副歌以一个主动动作作为中心：完整地看见真实发生过的一切，而不是把伤害修成美好。不要使用剪碎、吹散、海浪等参考歌的标志意象。第二主歌承认自己也有逃避，桥段把相机转向正在发生的生活。最后副歌仍有疼痛，但不再为了维持旧判断修改事实。短句与延长句交替，关键动词放在易唱的重音位置，避免密集抽象名词和原作旋律。",
    "stylePrompt": "An original Mandarin dramatic pop ballad with a clear emotional decision at its center. Begin with a restrained keyboard texture and a close, low-intensity female vocal. Keep the early phrasing precise and allow space around the ends of lines. As the central statement arrives, broaden the vocal projection and bring in a firm rhythm section with selective string support. Let a short instrumental passage carry the tension between vocal sections. The second major refrain should sound more resolved through diction and phrasing, not merely louder. Gradually reduce the accompaniment after the final statement. Use an original melody and harmonic path; avoid artist imitation, constant maximum-volume singing and oversized orchestration that obscures the words.",
    "mvPrompt": "原创转译建议：摄影暗房中，人物一次次尝试把同一张合照处理得更完美；主歌用局部取景隐藏画外关系，副歌让照片与真实场景的宽幅画面形成差异；间奏中她停止调整，将整张照片放在自然光下；末段走到街上拍摄陌生人的普通生活，结束在一次没有修饰的观察。",
    "sources": [
      {
        "title": "Golden Era《剪爱》官方MV及词曲署名",
        "url": "https://www.youtube.com/watch?v=ZH9k3643BH8"
      }
    ],
    "evidence": {
      "taskId": "62f8c281-f809-4093-be12-f7954880a208",
      "actualModel": "gemini-3.8-flash",
      "auditNotes": [
        "raw40131/parsed36278字节及SHA核对一致。",
        "两次503、一次429后按18秒规则第4次200；未追加第5次。",
        "删除68BPM、Fender Rhodes型号、管乐具体种类、海浪音效等未独立确认细节。",
        "没有把旋律、编曲、歌手机能或专辑制作混为词作手法；张雨生制作意义需专辑级证据。",
        "时间为原生模型观察，未人工复听；原创MV未复制原片红衣海岸叠化。"
      ],
      "durationSec": 279
    }
  },
  {
    "id": "fang-nunchucks",
    "title": "双截棍：密集动作短句与稀疏钩子的节奏反差",
    "contributor": "方文山词；周杰伦曲；周杰伦演唱",
    "basis": "native_audio",
    "highlights": [
      "词作方法：用具体动作、物件和连续短句建立人物，而非只重复态度；密集叙述与简短应答形成字数和节奏密度反差，迁移时更换整个职业与价值冲突。",
      "21–55秒：原生音轨记录快速切分说唱、短气口与弹性咬字；让辅音起音和句尾停顿成为节奏的一部分，不只是把字念快。",
      "55–133秒：失真吉他的块状重音与密集人声相互推动；方法上保留清晰重拍及短口号式回应，避免把全频段一直堆满。",
      "133–165秒：原生观察记录重编制收缩至钢琴式清晰音色和更疏的节奏；后段重新回到强奏，通过材质和密度变化制造冲击。"
    ],
    "lyricPrompt": "写一首普通话原创节奏说唱歌词：年轻修表匠在自动化工厂里，从炫耀速度走向理解精准与耐心。快段用连续、具体、可见的操作动词带动叙事：拆外壳、拧螺钉、擦齿轮、校游丝、装回秒针；每个动作都推动同一件维修事故，不把工艺术语列成清单。以长短不齐的口语短句组织切分，在一组密集句里安排自然气口、内韵与句尾短停，使辅音起音也成为节奏。密集叙述之后安排一个新写的四至六字短应答，字数明显少于快段，可由本人回应或少量叠声回应；应答的意义要随人物的失误和领悟改变，不使用现成口头禅。第一轮追求快，因漏掉细小零件而停住；中段随伴奏疏化，把语速和词量一起降下来，用留白、一次自我修正和听秒针的动作呈现转折，不硬塞煽情预副歌或宏大道理。最后恢复快段，但操作顺序更准确、气口更有分寸，短应答从逞强变为对手艺的承诺。用新故事、新韵脚和新旋律，不用武器名称、武术口号或原曲标志性拟声句。",
    "stylePrompt": "An original Mandarin rap-rock track with tight syncopation, punchy drums and chunky distorted-guitar riffs. Use a firm, springy groove that gives rapid vocal syllables clear places to land. Keep the lead rhythmic and articulate, alternating dense conversational lines with short, memorable responses. Add occasional bright bowed- or plucked-string accents as contrasting colors, without overcrowding the guitar register. Use clipped ensemble stops to make the next attack feel stronger. In the middle, strip the texture back to a clean piano-led passage and a more open vocal rhythm before rebuilding the full band. Keep bass controlled and the voice intelligible through the distortion. Favor rhythmic confidence over constant screaming. Create new riffs, a new hook and an individual vocal character.",
    "mvPrompt": "以下是原创视觉转译建议，不是原MV观察：前奏以齿轮的近景建立触感；主歌在明确空间中跟随人物完成与主题有关的日常动作，用放大镜作为关系变化的线索；副歌转向人物的选择，围绕‘先以速度证明自己，后以精准和耐心找回价值’设计一次可见行为，而非逐句插图；尾奏回到开头物件，让使用方式或摆放位置发生变化。依据实际音乐的收放安排景别和剪辑，不复制参考MV角色、场景组合或情节。",
    "sources": [
      {
        "title": "周杰倫 Jay Chou【雙截棍 Nunchucks】Official MV（周杰倫 Jay Chou）",
        "url": "https://www.youtube.com/watch?v=OR-0wptI_u0"
      }
    ],
    "evidence": {
      "taskId": "a038d380-be86-409b-a43e-fb006db9a0d1",
      "actualModel": "gemini-3.8-flash",
      "auditNotes": [
        "时间和音乐观察来自本次原生模型，未独立人工常速审听；方法提示词为原创迁移建议。",
        "未独立测量BPM、调性、和弦和音高；消费层不采用原始模型猜测的精确值。",
        "歌词作者、作曲者、演唱者职责分别记录，不能把整体编曲归于词作者。",
        "原始字幕字段不作为可发布的完整歌词库；消费层只概述方法，不复述歌词。",
        "原始模型声称精确BPM、drop-D调弦、808低频及曲风开创史，未提供独立证据，均不纳入方法卡。",
        "古筝/扬琴/二胡等具体音色归属未经独立听辨，风格提示使用可执行但不冒充精确转录的音色家族描述；视觉打击与水声不当作已核音乐要素。"
      ],
      "durationSec": 205
    }
  },
  {
    "id": "amei-dreamer",
    "title": "空中的梦想家：先给出明亮邀请，再落到普通人的愿望",
    "contributor": "张惠妹演唱；杨立德词；陈志远曲、编曲",
    "basis": "native_audio",
    "highlights": [
      "原生听辨将开头识别为核心副歌前置：先让听众抓住明亮的邀请，再用主歌补充生活处境；这一顺序可用于需要迅速建立共同情绪的歌曲。",
      "词作把梦想落在拥有归处、有人交谈等普通愿望上，宏大主题由日常需求支撑；天桥和车流属于影像观察，不应误当成歌词细节。",
      "模型观察到键盘、电吉他、鼓与贝斯共同维持轻快推进，主歌相对收拢，副歌扩展人声与伴奏层次；这里借鉴的是密度变化，不复制旋律或电台呼号。",
      "宽展的副歌与较亲切的叙述形成对照，最后一次返回可由独唱扩展为多人回应，让希望成为互相支持的行动。"
    ],
    "lyricPrompt": "写一首原创国语流行歌，主题是几个普通人互相帮忙，让搁置的小愿望重新开始。以一句简短、可回应的邀请开场，但不用天空、飞行、广播或信号作为核心意象。故事发生在社区周末修理铺：有人带来掉链的自行车，有人借走尺子修旧书架，有人第一次尝试给孩子缝书包。主歌把每个人不敢开口的请求写成具体动作；预副歌让一个人的举手得到另一个人的回应；副歌把独自完成的压力变成一起慢慢做，不承诺所有梦想都会实现。第二段增加一次实际失败和邻居的帮助，桥段留下工具停下的片刻，再由众人接上最后一次副歌。结尾用修好的车轮重新转动收束。语言朴素，有呼吸感；不要复用参考歌的标志句、中英呼号、旋律或句式组合。",
    "stylePrompt": "An original uplifting Mandarin pop-rock song with an inviting chorus presented before the first narrative verse. Build a buoyant groove from clear drums, warm bass, bright electric-guitar responses and a lightly sparkling keyboard layer. Let the verse reduce instrumental density so that ordinary details remain easy to follow. Broaden the chorus through melodic space and supportive backing voices rather than constant vocal force. Give the second verse a little more rhythmic momentum, then create a brief quiet bridge before the final communal response. The lead should move naturally between conversational phrases and open sustained notes. Finish with a short instrumental continuation that preserves the forward motion. Create new melodies, rhythmic hooks and vocal character; avoid recognizable station calls or signature motifs from existing songs.",
    "mvPrompt": "可选原创视觉转译：开场沿一张工作台拍三双手接力传递工具；主歌分开呈现自行车、书架和书包的修理困难；第一次副歌让人物从各自的小桌走向共同工作台。桥段保留失败后停手的短暂安静，另一人把工具推过来；末次副歌跟随修好的车轮穿过社区，人物逐个加入。用动作呼应音乐层次，不沿用参考MV的烟花、天桥、舞台叠印和月轮组合。",
    "sources": [
      {
        "title": "官方MV与词曲资料",
        "url": "https://www.youtube.com/watch?v=qqCaEVgmyXQ"
      },
      {
        "title": "厂牌专辑资料",
        "url": "https://forward-music.blog/張惠妹_姊妹/"
      },
      {
        "title": "实体唱片编曲资料",
        "url": "https://www.cdhkonline.com/product-page/張惠妹-姊妹"
      }
    ],
    "evidence": {
      "taskId": "be1a06e6-7b8f-48a0-9099-bad615d6484a",
      "actualModel": "gemini-3.8-flash",
      "auditNotes": [
        "29结构项、5音段、291秒区间覆盖；原始与解析内容相等及SHA通过。结构覆盖不能证明逐镜和听辨质量。",
        "模型将天桥和深夜画面写作歌词意象，消费层剔除；歌词方法改为官方文字可支持的普通愿望和交流需求。",
        "精确125 BPM、slap bass、声带/胸腔机制、烟花声与各秒位未经人工复核，未进入消费提示词。",
        "原模型生成建议过度沿用原MV的烟花/天桥/月轮组合，已改为独立社区修理铺叙事。",
        "原生工具辅助观察，不代表人工常速听音或产品线上验收；制作建议是原创转译，不是原作事实。"
      ],
      "durationSec": 291
    }
  },
  {
    "id": "lin-renwoxing",
    "title": "任我行：让独立与归属互相质问",
    "contributor": "林夕词；泽日生曲；陈奕迅演唱",
    "basis": "native_audio",
    "highlights": [
      "词作方法：先让叙述者相信一种立场，再揭示自己也依赖被批评的事物；问题不以口号作答，而由人物承认选择的代价。",
      "0–25秒：原生音轨记录极简吉他式拨弦与低音衬底，提供思考空间；25秒后较低声区的人声承担叙事。",
      "中段伴奏从较轻的吉他和键盘色彩逐渐加入鼓与弦乐，情感随着论述展开，避免第一段就耗尽动态。",
      "175–225秒：原生结果共同描述更满的编制与更展开的人声；高潮可以保持清楚的语言和克制的尾音，强度无需等同于撕喊。"
    ],
    "lyricPrompt": "写一首粤语原创歌词，讲一个决定离职的人在最后一次集体合照前改变站位。以空白工牌、聚餐座位和不断亮起的群聊通知构成同一个离开公司的下午。第一段让叙述者自信地认为自己终于摆脱随大流，语气带一点自嘲，不能把同事写成没有思想的背景。随后用一个真实小动作反驳他的自信：他仍在等别人为他留座、喊他的名字。副歌提出一个新的可唱问题，承认想自由也想被接纳，不给励志式标准答案。第二段把观察方向转向自己：曾经反对的习惯也曾让自己安心，独立不是永远站在所有人对面。沿较长的旋律句组织自然粤语语序，关键转折留气口，避免为了押韵把观点说死。后段以同一句问题改变语境，从向别人索取许可转为愿意承担选择的后果；结尾在地铁换乘口做出具体决定，保留犹豫。不用参考曲动物意象、自由口号或标志性句式，不模仿原旋律及任何歌手声线。",
    "stylePrompt": "An original reflective Cantopop ballad with an unhurried acoustic-guitar opening and a warm lower-register male lead. Establish an intimate speaking quality before gradually adding rounded bass, light keyboard colors, restrained drums and moving strings. Shape longer melodic sentences around natural Cantonese phrasing, with deliberate breaths at changes of thought. Let the arrangement grow as the narrator questions his own certainty; avoid a dramatic peak in the opening verse. Broaden the chorus into a fuller ensemble while keeping consonants intelligible and the vocal emotionally controlled. Use sustained notes and carefully released phrase endings rather than constant belting. Allow the final section to lose weight gradually, leaving a reflective instrumental space. Create new melodic material and an individual vocal character without imitating a reference performer.",
    "mvPrompt": "以下为原创视觉转译，不是原MV观察，具体剪辑点应跟新歌实际段落确定。前奏：固定近景，一张已抽掉姓名纸的工牌躺在桌上，手伸入画面又收回；缓慢拉开才看见办公室正在摆合照椅子。第一主歌：主人公站在队伍外整理外套，手机连亮两次群聊通知，他刻意扣住屏幕；镜头随后看见他仍偷偷数聚餐桌边空着的座位。伴奏逐渐变满时，同事拉出一把椅子，他先摆手，下一镜却把自己的杯子放在那张椅子前，用动作反驳嘴上的决绝。副歌：摄影者示意合照，他从门边走入队伍，主动站在侧边而非中心；快门后不立即冻结成宣传照，留住他把工牌交回桌上、又接过同事递来的外套。第二主歌：同一张空椅子从他视点改为同事视点，揭示留座不是挽留命令；主人公回一条简短讯息后把手机放进袋中。后段高潮：地铁换乘口，远景同时保留两条方向线，他停一步，取出写着新地址的纸再走向自己的线路。尾声：车门反光中，他不删群聊，只把工牌绳收进包里；让选择和仍然需要归属同时存在。",
    "sources": [
      {
        "title": "陳奕迅 Eason Chan - 任我行 (Official Music Video)（universalmusichk）",
        "url": "https://www.youtube.com/watch?v=oYw4uH80gcw"
      }
    ],
    "evidence": {
      "taskId": "d57090e4-3ca8-4276-b732-3d12d9f9fdd6",
      "actualModel": "gemini-3.8-flash",
      "auditNotes": [
        "时间和音乐观察来自本次原生模型，未独立人工常速审听；方法提示词为原创迁移建议。",
        "未独立测量BPM、调性、和弦和音高；消费层不采用原始模型猜测的精确值。",
        "歌词作者、作曲者、演唱者职责分别记录，不能把整体编曲归于词作者。",
        "原始字幕字段不作为可发布的完整歌词库；消费层只概述方法，不复述歌词。",
        "已逐项对账：摘要前奏0–25秒、主歌26秒与audioTrack0–25秒及26秒voice_change一致；摘要终段副歌171–225秒与audioTrack175–240秒高潮段及180秒齐奏、225秒打击退出吻合。摘要226秒后尾声与音轨240秒后轻哼/280秒伴奏淡出是细分包含关系，未见互斥事件；不把175或240秒大分段边界当作精确副歌入点/尾声起点。其余未直接有cue相互印证的129秒第二主歌等细分不对外发布为精确时间。",
        "编曲者身份与环绕声等未独立核验的断言未纳入；原始MV画面与声音混写内容未作为音乐证据。"
      ],
      "durationSec": 293
    }
  },
  {
    "id": "dalabengba",
    "title": "达拉崩吧（2020现场）：让角色换声推动故事",
    "contributor": "ilem作词、作曲；周深现场演唱；本次现场编配署名未独立核定",
    "basis": "native_audio",
    "highlights": [
      "18–74秒的原生音轨记录了不同角色音色接力，约20、35、51秒分别出现较细、较明亮和较低沉的声音；角色区别同时体现在说话姿态和轮到谁回应。",
      "74–120秒节奏与电子伴奏更突出，随后较低的角色音色与较高的人声形成对答；声音变化承担叙事身份，而非单纯炫技。",
      "重复句式和长专名使“报名字—误听—纠正”成为可唱的戏剧动作；曲词作者负责故事与语言机关，现场演唱负责把多个角色分清。",
      "本条仅研究已提交的2020竞演版本；模型给出的C6、具体喉腔机能、精确声轨数和由舞步推测的脚步声均不作为事实或生成要求。"
    ],
    "lyricPrompt": "写一首原创中文喜剧叙事歌：深夜火车站失物招领处来了三位各执一词的旅客，他们都声称同一把旧伞属于自己。用旁白、严谨值班员、急性子旅客和从容老人四种说话节奏区分角色，不靠现成影视人物和方言刻板印象。每一轮对答复用一个短问句，但回答暴露新的事实；把冗长的行李描述做成节奏递增的口语排比，不采用超长西幻人名、勇士救公主或屠龙情节。中段误会扩大到站内广播，最后发现旧伞只是失物柜公用伞，众人一起护送真正怕雨的孩子。结尾用最朴素的一句收掉前面的繁复。",
    "stylePrompt": "Original theatrical Mandarin electro-pop with a playful narrative. Use a single versatile singer or a small cast to distinguish four characters through register, articulation and rhythmic phrasing, keeping every line intelligible. Build from a light spoken-sung opening into bouncy electronic drums and a crisp synth-bass groove. Repeated question-and-answer motifs should change meaning as the story develops. Insert a brief instrumental dance break as a narrative interruption, then bring contrasting voices into rapid but clearly separated dialogue. Finish with a concise, unexpectedly plain phrase. No copied melody, signature vocal imitation, borrowed character names or mandatory extreme pitches.",
    "mvPrompt": "原创转译：雨夜火车站失物招领窗口，四种灯位与固定站位对应四个角色。每次换声才切到正在说话的人，保证谁问谁答清楚；节奏段用传递失物单、开柜门和雨伞交接形成动作节拍。误会升级时镜头从窗口内外反打扩大为站厅全景；结尾几个人挤在同一把伞下送孩子离开，柜台留下写着“公用”的标签。",
    "sources": [
      {
        "title": "【纯享】#周深 挑战二次元神曲《#达拉崩吧》解锁魔性舞步 | 歌手·当打之年 | Singer 2020 | MangoTV",
        "url": "https://www.youtube.com/watch?v=XHedu3KcPP0"
      },
      {
        "title": "Qobuz 歌手当打之年第八期词曲署名",
        "url": "https://www.qobuz.com/ar-es/album/-/fx2h4ss6mluia"
      }
    ],
    "evidence": {
      "taskId": "38f506a8-542d-4fd3-ad2e-d2f0650ce43f",
      "actualModel": "gemini-3.8-flash",
      "auditNotes": [
        "首attempt503，等待18秒后第二attempt200；非新任务重复购买。",
        "raw72550/parsed68015字节及SHA一致；音轨与摘要对前段角色切换及中段电子律动一致。",
        "原曲作者ilem，2026周深/五月天同名Live发行不能用于2020现场编配署名。",
        "未人工复听，使用原生模型音频token及可核时间事件；排除精确C6、喉腔机能、声轨数、舞步脚步声等无独立支持项。"
      ],
      "durationSec": 256
    }
  },
  {
  "id": "studio-tianxia",
  "title": "天下无双：无字引子与有词叙述的反差",
  "contributor": "樊馨蔓、时勇词；陈彤曲；张靓颖演唱；本候选编曲署名未独立核验",
  "basis": "native_audio",
  "highlights": [
    "约0–53秒：模型把开篇识别为无字人声引子，随后进入轻声有词叙述。可复用的是“先给情绪与空间，再交代故事”的顺序，不必照搬引子长度。",
    "约53–115秒：从柔和主歌向较强长音与更厚伴奏推进；歌词的叙述与演唱的动态共同形成反差，但高音属于演唱处理，不能全部算作词作亮点。",
    "约115–153秒：模型标注器乐间奏，给下一轮叙述留出缓冲；后半轮再扩张。具体段落切点尚未人工复听，不作为剪辑锁秒。",
    "本来源为315秒第三方录音室候选转传，画面是静态宣传封面。模型未报告现场掌声，但未经母带指纹比对，不能宣称已确认2006原版或完整母带。"
  ],
  "lyricPrompt": "写一首原创中文抒情歌，主题是长久分别之后，一个人仍愿意为自己的选择负责。开篇预留短小无字吟唱，让空间先出现；进入主歌后，借一处多年无人修理的渡口、一件重新穿上的旧外衣写人物的当下行动，不堆砌仙侠术语。第一段只交代一个未完成的约定，预副歌承认时间与距离确实改变了人；副歌用简短而可延长的元音句，表达即使无法重逢也愿意守住自己选择的生活。第二段让人物实际离开原来的等候位置，间奏之后的重复副歌保留节奏骨架，但把被动等待改为主动前行。情感要有克制、展开、回落，不用死亡或生生世世等绝对誓言充数。避免复写参考作品的歌词、标志性意象组合与旋律。",
  "stylePrompt": "An original Mandarin cinematic ballad with a spacious, flowing pulse. Begin with a short wordless female vocal phrase over a sparse orchestral texture, then move into a quiet, intimate verse with clear diction. Create contrast through vocal dynamics and accompaniment density rather than constant high notes. Let the chorus open into sustained melodic lines with a fuller string texture and a grounded low register. Use an instrumental passage to release tension before the next verse. Reserve the widest vocal range for one earned peak, then return to a simpler texture. Keep the lead melody natural and singable, with controlled reverberation and breathing room between phrases. Avoid borrowed melodic hooks, excessive vocal acrobatics, and artist imitation.",
  "mvPrompt": "原创转译建议，非原片镜头观察：无字引子用远景建立渡口与水面，暂不交代人物关系；有词主歌才切近景，看人物修补旧外衣、收起行囊；第一轮副歌让人物走出室内，画幅从局部打开；器乐间奏留给空船与风吹过的绳索；末轮人物实际离岸，结尾回到被留下的渡口，动作完成而情绪不做答案。",
  "sources": [
    {
      "title": "实际读取：DongxihaiHao录音室候选转传，315秒",
      "url": "https://www.youtube.com/watch?v=FyI8gApNzBU"
    },
    {
      "title": "滚石官方作品说明，用于词曲署名核对",
      "url": "https://www.youtube.com/watch?v=M3k9PhyNEto"
    },
    {
      "title": "2006滚石官方Topic版本，313秒，网页不可播放，仅作为版本参照",
      "url": "https://www.youtube.com/watch?v=Na3d4MxfStg"
    }
  ],
  "evidence": {
    "taskId": "b603e156-6113-4366-86c0-349630eefd4e",
    "actualModel": "gemini-3.8-flash",
    "auditNotes": [
      "原始与解析文件SHA匹配，计数相等；覆盖仅证明结构。",
      "模型将静态海报拆成32个证据区间，不是32个剪辑镜头。",
      "删除海豚音、花腔、真假音、生理声区及具体乐器组合等未经独立确认的断言；不将词曲、编配、演唱混为一人功劳。",
      "已对照keyMoments、shots与audioResolution：252秒后人声渐收、器乐渐弱并不互斥，未发现事件矛盾；工具听审结构一致。",
      "时间为工具听审近似观察，不作为逐帧剪辑锁秒；未进行人工逐段复听，但不将此单独列作内容矛盾或入库阻断。",
      "来源非官方，315秒与官方313秒略有差异，未经音频指纹比对。"
    ],
    "durationSec": 315
  }
},
  {
  "id": "liu-youni",
  "title": "有你：把陪伴写成给对方留出的空间",
  "contributor": "陈曦词、董冬冬曲及制作，刘宇宁演唱；词曲署名以JOOX发行页独立核对。",
  "basis": "native_audio",
  "highlights": [
    "词作方法：先解除对结局与过去的要求，再提出当下的陪伴；让承诺从具体关系选择中长出来，避免开篇堆砌永恒誓言。",
    "约17–45秒为较克制的人声叙述，约60–90秒伴奏明显丰满；两段在音轨与摘要中的描述一致，可借疏密对比让安慰逐渐变得坚定。",
    "约106–120秒的器乐间隔在音轨与摘要中一致，可作为情绪消化的空间；不要为了持续表达而把每一拍都填满歌词。",
    "本次实际来源是歌迷频道的215秒滚动歌词视频，不是剧情MV；下方视觉提示为原创方案。"
  ],
  "lyricPrompt": "写一首原创中文都市抒情歌，主题是给亲近的人保留选择的空间。主歌发生在搬家前夜，两个人整理共同住过的房间：主人公把不属于自己的书放回纸箱，替对方补好松动的提手，听见走廊电梯到了却没有催促。用这些动作表达关心，不替对方解释人生。副歌从克制观察转向一个具体邀请：疲惫时可以来坐一会儿，不必先有好消息；允许对方离开，也保留平等相见的可能。第二主歌让主人公开始整理自己的生活，避免把陪伴写成单方面牺牲。间奏后再唱核心意思时，增加一件已经做到的小事，使态度更坚定。使用自然口语和适量留白，不照搬参考歌词意象、排比或旋律。",
  "stylePrompt": "Original warm Mandarin pop ballad with an intimate male lead, lightly picked acoustic guitar, restrained piano and a rounded bass foundation. Keep the opening vocal section sparse and conversational, then broaden the chorus with supportive drums and sustained strings. Leave a short instrumental breathing space before rebuilding the emotional intensity. Favor clear phrasing and gradual dynamic growth over constant belting. No fixed tempo claim, no copied melodic hook and no named-singer imitation.",
  "mvPrompt": "原创视觉转译：搬家前夜以整理纸箱和修补提手的近景建立关系；副歌拉开到两人各坐一边的空房全景，保留空间与沉默；器乐间隔跟随主人公擦净窗台；结尾分别出门，在楼下自然挥手。不要将这些原创画面说成原视频内容。",
  "sources": [
    {
      "title": "实际读取来源：摩登兄弟刘宇宁-有你 (《爱情有烟火》电视剧片尾曲)",
      "url": "https://www.youtube.com/watch?v=GRr6pkkfApM"
    },
    {
      "title": "独立词曲署名：JOOX发行页",
      "url": "https://www.joox.com/my-zh_cn/album/qiuxl714FshM5nJ%2BMXCn5g%3D%3D"
    }
  ],
  "evidence": {
    "taskId": "59274df5-cc6f-435b-9b1a-d3ac83bc1df2",
    "actualModel": "gemini-3.8-flash",
    "auditNotes": [
      "只采用17–45、60–90、106–120秒一致区间；58/60及120/122秒边界不作精确锁秒结论。",
      "JOOX独立核对词曲；歌迷视频与正式录音尚未音频指纹核验，保留版本边界。",
      "删除模型72BPM、四二拍及发声生理机制断言；无人工独立常速听审。",
      "2026-10-16 主代理复核完整候选方法；仅采用研究代理核对的一致区间，保留来源版本与未决问题。此为代理审查，不冒充新增模型顾问回执或人工听片验收。"
    ],
    "durationSec": 215
  }
},
  {
  "id": "jeff-guohuo",
  "title": "过火：让自我辩解推动情绪逐层加重",
  "contributor": "陈佳明词、曹俊鸿曲、屠颖编曲，张信哲演唱；依据官方来源说明分列职责。",
  "basis": "native_audio",
  "highlights": [
    "词作方法：叙述者先解释自己的退让，再看见退让带来的后果；可复用的是心理自辩的递进，不是把无边界牺牲当成关系建议。",
    "约28–55秒的克制人声与轻钢琴、低音及鼓点形成清晰底层，约85–115秒编制和演唱力度更饱满；一致区间支持从低密度叙述走向更强情绪。",
    "约126–150秒器乐领奏在音轨与摘要中对应；给人声退出的空间，让未说完的情绪由旋律延续。",
    "约169–190秒再进入叙述，约214–260秒再次扩张；重复的价值来自情绪与信息的加重，不只是把前段复制一遍。"
  ],
  "lyricPrompt": "写一首原创中文抒情歌，采用第一人称回看一段逐渐失衡的关系。主歌从主人公反复替两个人取消约定、把没用过的车票压进抽屉写起，先讲自己当时如何解释这些小事，语气克制，不急着责怪。推进段让主人公第一次承认，那些解释并没有让两个人更靠近。副歌用完全新写的短句表达仍然在意，却不能继续替两个人作决定；让爱与边界同时存在。第二段加入一次坦诚但没有得到预期回应的谈话，使后段情绪有新依据。安排一段器乐呼吸，再回到核心意思，结尾以取出旧车票、开始自己的行程收束。不要复制原作的责任归因、标志句或旋律，也不要把伤害合理化。",
  "stylePrompt": "Original Mandarin pop ballad with a clear expressive male vocal, a sparse piano and soft sustained-keyboard opening, rounded bass and restrained drums beneath the first verse. Let a later refrain broaden into fuller drums, strings and supportive electric-guitar texture while preserving vocal clarity. Include a lyrical wind-instrument lead in the instrumental break as an original arrangement choice, then rebuild from a quieter returning verse. Use emotional contrast and gradual intensity rather than uninterrupted maximal singing. Avoid fixed BPM, copied melodies and singer cloning.",
  "mvPrompt": "原创视觉转译：主人公在客运站整理一叠没有使用的车票，回忆段只表现两人错开的行动；伴奏增厚时用更远的构图呈现空出的座位；器乐间隔让公交驶出站台；结尾主人公独自登车。画面承担叙事，勿据其动作虚构门声或环境音。",
  "sources": [
    {
      "title": "实际读取来源：張信哲 Jeff Chang [ 過火 ] 官方完整版 Official MV",
      "url": "https://www.youtube.com/watch?v=SrD36rogSjc"
    }
  ],
  "evidence": {
    "taskId": "c3d75fd6-0621-4d65-bca6-8231db425514",
    "actualModel": "gemini-3.8-flash",
    "auditNotes": [
      "采用28–55、85–115、126–150、169–190、214–260秒交集，避开原稿57/62、78/82和276/286矛盾边界。",
      "原文精确萨克斯种类、声带/真假音机制、八度和声等未独立证实，均不作为事实；风管领奏仅作原创编曲选择。",
      "不采用关门画面推音效，不发布完整锁秒结构；原始争议仍保留advisor-review。",
      "2026-10-16 主代理复核完整候选方法；仅采用研究代理核对的一致区间，保留来源版本与未决问题。此为代理审查，不冒充新增模型顾问回执或人工听片验收。"
    ],
    "durationSec": 303
  }
},
  {
  "id": "jolin-sunset",
  "title": "日不落：让明亮的律动承接轻快的告白",
  "contributor": "崔惟楷中文词；Alexander Bard、Anders Hansson作曲；蔡依林演唱。依据Shazam版权署名独立核对。",
  "basis": "native_audio",
  "highlights": [
    "词作方法：把外部景物的明暗与动静转成恋爱中的感受，再在核心段落主动表达心意；新作应换一组生活场景，不复制旅行和邮寄意象。",
    "约22–35秒轻盈人声与合成器、低音律动并行，约53–70秒伴奏更饱满；音轨与摘要在这些区间一致，可把稳定律动当底座，用编制密度扩大告白。",
    "在更满的段落里保留清楚短句与节奏落点，重复核心意思时改变互动细节，让轻快感持续发展。该条为创作迁移建议，不是精确音高测量结论。",
    "原片为实拍MV；城市地标画面不能单独证明钟声的具体声源，下方视觉方案为原创。"
  ],
  "lyricPrompt": "写一首原创中文轻快流行歌，场景设在周末社区修理市集。主歌用一起挑旧唱片、试亮修好的小台灯、给松动椅脚垫纸片等两三个动作写出两人相处的自在，句子自然短促，先有互动再显露心意。推进段加入一次眼神或动作上的小误会，随即被对方轻松化解。副歌主动邀请对方下次仍一起出现，用一个完全原创、口语而易记的短句承接喜悦，不宣誓永恒。第二段补充对方主动照顾主人公的细节，形成双向关系。后段重复核心意思时换一个具体行动，让快乐有新进展。避免沿用参考歌的天空天气、旅行明信片等意象组合，也不复制旋律与标志句。",
  "stylePrompt": "Original upbeat Mandarin synth-pop with a buoyant bass line, steady dance-oriented drums, bright short synthesizer accents and a clear light female lead. Keep the verse rhythm nimble and uncluttered, then widen the chorus with fuller sustained layers and modest backing vocals while maintaining a readable lyrical rhythm. Let a short instrumental answer separate phrases without breaking the forward pulse. Choose an original melodic hook and retain dynamic contrast; avoid fixed BPM assertions, named-performer imitation and copied motifs.",
  "mvPrompt": "原创视觉转译：两人在社区修理市集分别试用旧物，以手部动作与轻快步行建立节奏；副歌让两人搬着修好的椅子穿过场地，用连续中景显露默契；结尾把台灯留给下一位来客。不要复刻原MV的伦敦地标或旅行镜头。",
  "sources": [
    {
      "title": "实际读取：官方MV",
      "url": "https://www.youtube.com/watch?v=1GA8z-Wliew"
    },
    {
      "title": "独立版权署名：Shazam",
      "url": "https://www.shazam.com/zh-tw/song/1725226209/%E6%97%A5%E4%B8%8D%E8%90%BD"
    }
  ],
  "evidence": {
    "taskId": "455ef21b-7c0d-424c-b5c3-d14a7ecdd47c",
    "actualModel": "gemini-3.8-flash",
    "auditNotes": [
      "只采用22–35、53–70秒一致区间；81/90、100/107、156/165秒争议保留，不称完整结构已验证。",
      "Shazam分别列Alexander Bard和Anders Hansson为作曲家、崔惟楷为作词；不采用其他聚合页将全名切成额外作者的写法。",
      "删除未经独立测量的128BPM、音程/生理断言；不以地标画面证明大本钟声源。",
      "本卡为人工编辑后的待顾问候选，未独立常速听审。",
      "2026-10-16 主代理复核完整候选方法；仅采用研究代理核对的一致区间，保留来源版本与未决问题。此为代理审查，不冒充新增模型顾问回执或人工听片验收。"
    ],
    "durationSec": 222
  }
},
  {
  "id": "lee-awake",
  "title": "梦醒时分：先接住对方的话，再把视线带向行动",
  "contributor": "李宗盛词曲、李正帆编曲、陈淑桦演唱；依据滚石官方说明分列。",
  "basis": "native_audio",
  "highlights": [
    "词作方法：由倾听对方的困惑进入，再逐步提出更清醒的看法。劝慰应建立在具体听见的处境上，避免开头就替别人下结论。",
    "约33–55秒以清楚而克制的人声承担叙述，约65–90秒节奏与情绪更展开；采用音轨与摘要一致的片段，不引用有争议的第二段边界。",
    "副歌可以减少事件描述，转而提供一个能采取的小行动；这属于原创写作建议，不把参考歌的完整句式直接套入。"
  ],
  "lyricPrompt": "写一首原创中文抒情流行歌，叙述者是陪朋友整理旧工作室的人。第一主歌先认真听朋友说起一次失败的合作，用桌上未装订的纸页、停用的工具和空出的工位交代困境，不急着安慰或评价。推进段由朋友的停顿转入叙述者的回应，承认失望的分量。副歌用自然口语提出一个具体可行的小行动：先把需要留下的东西收好，明天一起去吃早餐；不承诺一切马上变好。第二主歌让朋友自己做出一个选择，叙述者从建议者退到陪伴者。结尾留一个两人共同完成的普通动作。避免照搬原作的劝说句式、哲理警句、爱情意象和旋律，不把失意者写成需要被教育的人。",
  "stylePrompt": "Original Mandarin adult-contemporary pop with a warm clear female lead, bright electric-piano details, a rounded bass line and restrained rhythmic accompaniment. Let the opening vocal phrases sound conversational and attentive, then give the refrain a broader rhythmic foundation and a more open melodic contour. Preserve intelligible words and space between ideas. Favor composure and warmth over theatrical crying, without copying a melody, prescribing an unverified tempo or imitating a named vocalist.",
  "mvPrompt": "原创视觉转译：两人在旧工作室收拾物品，以双人中景保留倾听；副歌转到窗边，把将要带走的工具放进箱子；结尾朋友自己关掉台灯，两人一起走下楼。视觉是新方案，不能当原MV实证。",
  "sources": [
    {
      "title": "实际读取及署名：官方MV",
      "url": "https://www.youtube.com/watch?v=nku5zFMZAdU"
    }
  ],
  "evidence": {
    "taskId": "eb84463a-4f9b-413a-abb0-70d2b195ce67",
    "actualModel": "gemini-3.8-flash",
    "auditNotes": [
      "首句模型转录错误不引用；99–125秒主歌/器乐冲突和248.5秒超出235秒继续保留，完整曲式未验。",
      "仅采用33–55、65–90秒一致片段与官方署名；删韵辙、精确音程和胸头腔断言。",
      "2026-10-16 主代理复核完整候选方法；仅采用研究代理核对的一致区间，保留来源版本与未决问题。此为代理审查，不冒充新增模型顾问回执或人工听片验收。"
    ],
    "durationSec": 235
  }
},
  {
  "id": "jeff-faith",
  "title": "信仰：从反复被唤起的记忆走向明确表达",
  "contributor": "陈耀川、易家扬词；陈耀川曲；张信哲演唱。依据官方MV说明；不扩写未核编曲署名。",
  "basis": "native_audio",
  "highlights": [
    "词作方法：让外部触发物先唤起记忆，再让叙述者承认自己的遗憾，最后给出明确态度；避免一开始就用抽象大词宣布情感重量。",
    "约2–30秒以吉他为主的清透铺垫、约34–55秒克制的人声叙述，在音轨与摘要中一致，可用稀疏编制让记忆细节进入。",
    "约60–80秒情绪逐渐推进在两份描述中一致，可让句子从回想转向当下的选择；本卡不采用后续副歌与间奏冲突区间。"
  ],
  "lyricPrompt": "写一首原创中文抒情歌，主题是多年后决定把一件拖延的事情说清楚。主歌从主人公在旧书里发现一张手写修理单开始，回忆两人曾一起修好一台收音机的下午；用具体声音与动作唤起记忆，不写月光、远方或命定。第二部分承认当时一句敷衍的话如何让沟通中断，不替对方编造现在的心情。副歌转向明确但有边界的行动：愿意把真正想说的话写完，也接受对方选择是否回应。后段让主人公寄出一封普通信后回到自己的生活，不把重逢当必然奖励。句子由叙述逐渐变短、变肯定，保持原创歌词与旋律，避免宗教比喻和参考歌的核心排比。",
  "stylePrompt": "Original reflective Mandarin pop ballad with clear intimate male vocals, delicate acoustic-guitar figures and a restrained warm sustained background. Keep the first verse spacious enough for detailed storytelling. Gradually introduce a soft rhythmic foundation and broaden the emotional delivery as the narrator becomes more direct. For the new composition, allow the refrain to open into fuller supportive instrumentation without making every phrase a climax. Avoid copied hooks, fixed BPM claims, exact interval prescriptions and named-singer imitation.",
  "mvPrompt": "原创视觉转译：旧书中的修理单引出回忆，近景记录纸张和收音机；推进段回到当下书桌；副歌让主人公走到邮筒前投信，最后镜头留在其继续前行的背影。该方案与原片水下等场景分开。",
  "sources": [
    {
      "title": "实际读取及署名：官方MV",
      "url": "https://www.youtube.com/watch?v=QoPxzsqGodk"
    }
  ],
  "evidence": {
    "taskId": "6057f0e3-cf63-4c04-a699-03039281f0bc",
    "actualModel": "gemini-3.8-flash",
    "auditNotes": [
      "86/114/126秒副歌、121/161秒间奏矛盾未解决，本卡仅保留2–30、34–55、60–80秒。",
      "删水波画推声、未测八度/发声机制及杜自持编曲归因；英文Style为原创方向，不声称后续原曲段落已验证。",
      "2026-10-16 主代理复核完整候选方法；仅采用研究代理核对的一致区间，保留来源版本与未决问题。此为代理审查，不冒充新增模型顾问回执或人工听片验收。"
    ],
    "durationSec": 253
  }
},
  {
  "id": "airport",
  "title": "飞机场的10:30：让改不掉的小习惯显出失落",
  "contributor": "陶喆、娃娃词；陶喆曲及演唱。词曲由JOOX独立核对，不扩写未核编曲署名。",
  "basis": "native_audio",
  "highlights": [
    "词作方法：借一个仍然为对方保留的小习惯，让关系的缺席自然显现；细节先于解释，比直接宣布难过更有叙事空间。",
    "约25–58秒的人声叙述与节奏、低音配合，在音轨与摘要中一致；约63–95秒和声层次增厚，可把重复情绪交给人声层次扩展。",
    "约210–235秒更延展的即兴人声在两份描述中对应；原创写作可减少文字，让声音接续没有说完的话，避免复制原作的转音与旋律。",
    "本卡只迁移生活细节与人声层次方法，不采用原模型关于洗发、黑板刮擦、倒带及精确音阶的断言。"
  ],
  "lyricPrompt": "写一首原创中文R&B情歌，地点是一家即将打烊的社区面馆。主人公已经独自来过许多次，却仍下意识把旁边的椅子拉开、把菜单转向无人坐着的一侧；用一个反复发生的小动作表达关系已经改变，不直接说无法忘记。主歌记录面馆里具体而普通的变化，推进段承认自己以前把习惯误当成了双方的默契。副歌用简短口语提出一个没有立即答案的问题，允许犹疑，不指责对方。第二段让主人公终于点了一份自己喜欢的食物，情绪由等待转向照顾自己。后段减少歌词，为原创的人声应答与短小器乐留空间。结尾把多拉开的椅子推回桌边，不写机场、航班、饮料或参考歌原有物件，不复制歌词与旋律。",
  "stylePrompt": "Original Mandarin R&B ballad with relaxed conversational male vocals, a supple bass line, soft drum groove, clean acoustic-guitar details and warm electric-piano color. Begin with an uncluttered narrative verse, then broaden the refrain through original layered vocal responses rather than sheer loudness. In a later section, allow expressive improvised phrases to stretch over the steady groove while keeping space between them. Use an original melody and harmonic setting; avoid fixed tempo or scale assertions, copied ad-libs and named-singer imitation.",
  "mvPrompt": "原创视觉转译：面馆即将打烊，近景记录主人公把椅子拉开又停顿；副歌维持双人桌的空位构图；后段换成侧面中景，看主人公认真吃完自己的那份面；最后把椅子推回，离开画面。不要据画面自行认定餐具或椅子声已存在于音乐。",
  "sources": [
    {
      "title": "实际读取：官方MV",
      "url": "https://www.youtube.com/watch?v=GurozK-HRTw"
    },
    {
      "title": "独立词曲署名：JOOX",
      "url": "https://www.joox.com/mo/single/ItqdiBo1Iv27FsvFdE7djw%3D%3D"
    }
  ],
  "evidence": {
    "taskId": "45df9fe7-d1aa-4a67-a104-b287f60c6087",
    "actualModel": "gemini-3.8-flash",
    "auditNotes": [
      "只保留25–58、63–95、210–235秒一致范围；169秒音轨标间奏与摘要182起间奏有差异，不发布完整结构。",
      "模型洗发等歌词概述不纳入；不采用画面导出的黑板、水声、倒带等音效，不把广播存在与性质当已独立复核。",
      "删五声音阶、三连音及胸声生理断言；原生模型证据不是独立人工常速听审。",
      "2026-10-16 主代理复核完整卡片，保留来源等级及版本边界；仅采用一致区间的方法，争议秒位不供精确时间轴使用；未新增模型顾问回执。"
    ],
    "durationSec": 302
  }
},
  {
  "id": "liu-jianghu",
  "title": "就在江湖之上：用聚散关系撑起开阔意境",
  "contributor": "严艺丹词曲，刘宇宁演唱。词曲与JOOX同曲的李相夷版独立交叉核对；不把另一演唱版本的制作信息套入本次音轨。",
  "basis": "native_audio",
  "highlights": [
    "词作方法：先建立开阔空间，再落到人物之间的聚散选择，让宏大意境与具体关系互相支撑；不只罗列江湖风物。",
    "约46–65秒的展开段落、约79–100秒的器乐缓冲，在音轨与摘要中对应，可用人声退出后的旋律延续情绪。",
    "约111–130秒回到较克制的叙述，约143–160秒再次展开，在两份描述中一致；第二轮应增加关系的新理解，而非只加大音量。",
    "本次来源为188秒歌迷滚动歌词版，未做与正式录音的指纹比对，不标官方实拍MV。"
  ],
  "lyricPrompt": "写一首原创中文国风流行歌，讲两位同行多年的工匠在渡口分别，各自带走一件共同修复过的器物。主歌从收起工具、检查船板、解下旧绳结等动作进入，不用江湖、明月、千杯或相忘等参考歌的标志意象。推进段让其中一人想挽留却先问对方下一程需要什么。副歌把宽广水面与具体的告别选择并置：不约定永远同行，但认可彼此所走的方向。第二主歌写分别后主人公第一次独自完成旧工作，加入伙伴留下的方法；器乐间隔后再唱核心意思时，从不舍转向祝愿。使用清楚可唱的现代中文，适量古典质感，不复制原歌词、旋律或意象排列。",
  "stylePrompt": "Original Mandarin cinematic folk-pop with an intimate male lead, light acoustic-guitar figures, a sustained wind-instrument color and supportive strings. Move from restrained narrative phrasing into a broader refrain with fuller percussion, then allow an instrumental passage to carry the emotion while the voice rests. Rebuild the next vocal section gradually and preserve contrast between closeness and openness. No copied melody, fixed tempo, prescribed pentatonic claim or named-singer imitation.",
  "mvPrompt": "原创视觉转译：两人在渡口整理共同使用的工具，固定双人中景保留迟疑；副歌拉开看见河面和两条不同方向的路；器乐段追随船离岸；结尾主人公在新工位继续工作。此为原创方案，原来源只有滚动歌词。",
  "sources": [
    {
      "title": "实际读取来源",
      "url": "https://www.youtube.com/watch?v=gp3qaHKAwic"
    },
    {
      "title": "同曲词曲交叉核对：JOOX李相夷版，非本次听音版本",
      "url": "https://www.joox.com/mo/single/Xs%2BDoEWj4WUaJ38vZFVUFQ%3D%3D"
    }
  ],
  "evidence": {
    "taskId": "f006dc4c-050e-46da-a4d3-ff3b164f183b",
    "actualModel": "gemini-3.8-flash",
    "auditNotes": [
      "原摘要0–13秒前奏与audio2秒人声矛盾保留，不采用开头完整分段。",
      "仅采用46–65、79–100、111–130、143–160秒一致片段；未独立常速复听。",
      "删声带/混声/五声调式等无测量结论；歌曲作者交叉核对不证明两个演唱版本录音相同。",
      "2026-10-16 主代理复核完整卡片，保留来源等级及版本边界；仅采用一致区间的方法，争议秒位不供精确时间轴使用；未新增模型顾问回执。"
    ],
    "durationSec": 188
  }
},
  {
  "id": "liu-wushuang",
  "title": "无双：从具体抉择走向更宽阔的情绪",
  "contributor": "陈聆子词，徐林曲，刘宇宁演唱。词曲据豆瓣收录的发行说明核对；该说明属于二手来源。",
  "basis": "native_audio",
  "highlights": [
    "词作方法：让人物在险境中作出具体选择，再扩大到共同面对未来的态度；壮阔感应来自抉择，避免只堆砌宏大名词。",
    "约27–44秒的克制叙述与约62–110秒更饱满的伴奏，在音轨与摘要中对应；可迁移的是力度和密度的对比，不是发声生理标签。",
    "约136–145秒的器乐段落在音轨与摘要中一致，给密集情绪留出缓冲，再让后续人声回来。",
    "本次腾讯官方来源是192秒静态剧照与歌词字幕版，非剧情动态MV；不得把字幕分段数量当作真实运镜数。"
  ],
  "lyricPrompt": "写一首原创中文国风流行歌，主题是两名互不信任的守桥人在山洪来临时决定合作。主歌从一截被冲断的绳索、摇晃的木板和远处等待的人群写起，用动作建立风险，不铺陈人物头衔。推进段让双方先放下旧争执，交换各自掌握的办法。副歌表达把眼前这一步踏稳、让后来的人能够走过的共同选择；力量来自承担，不来自称霸或无敌。第二主歌让其中一人失误，另一人及时补位，承诺经过行动得到证明。安排器乐段展现洪水退去后的空桥，再回到简洁核心句。避免沿用参考作品词句、旋律、意象组合以及满篇抽象江湖口号。",
  "stylePrompt": "Original Mandarin cinematic pop with a grounded expressive male lead, restrained strings and light percussion under the narrative verse. Expand the refrain through fuller drums and a broader string texture while keeping the words intelligible. Use a short wind-instrument-led instrumental passage as an original arrangement choice to release tension before rebuilding. Let emotional force come from contrast, clear phrasing and musical space; avoid fixed tempo claims, copied melodic leaps and named-performer imitation.",
  "mvPrompt": "原创视觉转译：旧桥洪水中以绳索和脚下木板近景建立险境；副歌用双人全景显示两人实际配合；器乐段看水退后的桥；结尾让其他人安全通过。该方案为原创，不是从静态歌词版中观察所得。",
  "sources": [
    {
      "title": "实际读取来源",
      "url": "https://www.youtube.com/watch?v=7opZ7Tssm3E"
    },
    {
      "title": "词曲署名参考：豆瓣收录发行说明（二手）",
      "url": "https://music.douban.com/subject/35873034/"
    }
  ],
  "evidence": {
    "taskId": "026a91a0-0eec-4787-8ea5-8219cd16cdbe",
    "actualModel": "gemini-3.8-flash",
    "auditNotes": [
      "25/26、54/55/60及128/130秒差异不作精确锁秒；只使用27–44、62–110、136–145秒一致区间。",
      "不采用五声调式、平仄音程、强混/胸腔等未测结论；管乐仅作音色家族及原创编曲选择，不强认具体笛箫品种。",
      "豆瓣发行说明署名不是原始唱片内页；保留来源级别供顾问复核。",
      "2026-10-16 主代理复核完整卡片，保留来源等级及版本边界；仅采用一致区间的方法，争议秒位不供精确时间轴使用；未新增模型顾问回执。"
    ],
    "durationSec": 192
  }
},
];
