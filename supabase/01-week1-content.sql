-- Optional Week1 curriculum for a NEW empty database. No user/result data.
-- Existing activity orders are checked; customized content is never overwritten.
begin;
do $seed$
declare
 course bigint; week bigint; activity bigint; item jsonb; question jsonb;
 existing public.activities%rowtype;
begin
 insert into public.courses(course_code,title,access_code) values('CSDP-120','Introduction to Computer Programming','123456')
 on conflict(course_code) do nothing;
 select id into course from public.courses where course_code='CSDP-120';
 insert into public.weeks(course_id,week_number,title) values(course,1,'Week1') on conflict(course_id,week_number) do nothing;
 select id into week from public.weeks where course_id=course and week_number=1;
 for item in select value from jsonb_array_elements($content$[
  {
    "title": "Computers Are Perfectly Literal",
    "activity_type": "video",
    "activity_order": 1,
    "file_path": "supabase://course-media/csdp-120/week1/videos/1_Video.mp4",
    "activity_key": null,
    "questions": []
  },
  {
    "title": "What Is a Program?",
    "activity_type": "video",
    "activity_order": 2,
    "file_path": "supabase://course-media/csdp-120/week1/videos/2_Video.mp4",
    "activity_key": null,
    "questions": []
  },
  {
    "title": "Five Functional Parts of a Computer",
    "activity_type": "video",
    "activity_order": 3,
    "file_path": "supabase://course-media/csdp-120/week1/videos/3_Video_small.mp4",
    "activity_key": null,
    "questions": []
  },
  {
    "title": "Program vs. Machine — Summary",
    "activity_type": "video",
    "activity_order": 4,
    "file_path": "supabase://course-media/csdp-120/week1/videos/4_Video.mp4",
    "activity_key": null,
    "questions": []
  },
  {
    "title": "Speed Matters: CPU, RAM, Storage",
    "activity_type": "video",
    "activity_order": 5,
    "file_path": "supabase://course-media/csdp-120/week1/videos/5_Video.mp4",
    "activity_key": null,
    "questions": []
  },
  {
    "title": "Main Memory vs. Secondary Storage",
    "activity_type": "video",
    "activity_order": 6,
    "file_path": "supabase://course-media/csdp-120/week1/videos/6_Video.mp4",
    "activity_key": null,
    "questions": []
  },
  {
    "title": "A Closer Look at Secondary Storage",
    "activity_type": "video",
    "activity_order": 7,
    "file_path": "supabase://course-media/csdp-120/week1/videos/7_Video.mp4",
    "activity_key": null,
    "questions": []
  },
  {
    "title": "Video",
    "activity_type": "video",
    "activity_order": 8,
    "file_path": "supabase://course-media/csdp-120/week1/videos/8_Video.mp4",
    "activity_key": null,
    "questions": []
  },
  {
    "title": "Software: Two Big Categories",
    "activity_type": "video",
    "activity_order": 9,
    "file_path": "supabase://course-media/csdp-120/week1/videos/9_Video.mp4",
    "activity_key": null,
    "questions": []
  },
  {
    "title": "Summary",
    "activity_type": "video",
    "activity_order": 10,
    "file_path": "supabase://course-media/csdp-120/week1/videos/10_Video.mp4",
    "activity_key": null,
    "questions": []
  },
  {
    "title": "Video",
    "activity_type": "video",
    "activity_order": 11,
    "file_path": "supabase://course-media/csdp-120/week1/videos/11_Video.mp4",
    "activity_key": null,
    "questions": []
  },
  {
    "title": "Computer Parts: True or False",
    "activity_type": "challenge",
    "activity_order": 12,
    "file_path": null,
    "activity_key": "true_false",
    "questions": [
      {
        "question_order": 1,
        "question_type": "true_false",
        "question_text": "RAM keeps its contents when the power is off.",
        "options": [
          "True",
          "False"
        ],
        "correct_answer": {
          "value": "False",
          "choice_index": 1
        }
      },
      {
        "question_order": 2,
        "question_type": "true_false",
        "question_text": "The CPU is the fastest component in the system.",
        "options": [
          "True",
          "False"
        ],
        "correct_answer": {
          "value": "True",
          "choice_index": 0
        }
      },
      {
        "question_order": 3,
        "question_type": "true_false",
        "question_text": "A program runs directly from the hard drive.",
        "options": [
          "True",
          "False"
        ],
        "correct_answer": {
          "value": "False",
          "choice_index": 1
        }
      },
      {
        "question_order": 4,
        "question_type": "true_false",
        "question_text": "An SSD is an example of secondary storage.",
        "options": [
          "True",
          "False"
        ],
        "correct_answer": {
          "value": "True",
          "choice_index": 0
        }
      },
      {
        "question_order": 5,
        "question_type": "true_false",
        "question_text": "'Loading...' means copying storage -> RAM.",
        "options": [
          "True",
          "False"
        ],
        "correct_answer": {
          "value": "True",
          "choice_index": 0
        }
      }
    ]
  },
  {
    "title": "Modern Python Challenge",
    "activity_type": "challenge",
    "activity_order": 13,
    "file_path": null,
    "activity_key": "drag_drop",
    "questions": [
      {
        "question_order": 1,
        "question_type": "drag_drop",
        "question_text": "Webcam: Classify each device as input, output, both, or storage.",
        "options": {
          "item": {
            "id": "webcam",
            "name": "Webcam",
            "feedback": "A webcam sends captured images and video into the computer.",
            "image_path": "/textures/quiz/challenge-2-items/webcam.png",
            "model_path": "/models/challenge-2/webcam.glb",
            "model_rotation_y": 0
          },
          "categories": [
            "input",
            "output",
            "both",
            "storage"
          ]
        },
        "correct_answer": {
          "category": "input"
        }
      },
      {
        "question_order": 2,
        "question_type": "drag_drop",
        "question_text": "Projector: Classify each device as input, output, both, or storage.",
        "options": {
          "item": {
            "id": "projector",
            "name": "Projector",
            "feedback": "A projector displays information from the computer.",
            "image_path": "/textures/quiz/challenge-2-items/projector.png",
            "model_path": "/models/challenge-2/projector.glb",
            "model_rotation_y": 0
          },
          "categories": [
            "input",
            "output",
            "both",
            "storage"
          ]
        },
        "correct_answer": {
          "category": "output"
        }
      },
      {
        "question_order": 3,
        "question_type": "drag_drop",
        "question_text": "Computer: Classify each device as input, output, both, or storage.",
        "options": {
          "item": {
            "id": "computer",
            "name": "Computer",
            "feedback": "A computer receives input and produces output for the user.",
            "image_path": "/textures/quiz/challenge-2-items/touchscreen.png",
            "model_path": "/models/challenge-2/computer.glb",
            "model_rotation_y": 0
          },
          "categories": [
            "input",
            "output",
            "both",
            "storage"
          ]
        },
        "correct_answer": {
          "category": "both"
        }
      },
      {
        "question_order": 4,
        "question_type": "drag_drop",
        "question_text": "USB Flash Drive: Classify each device as input, output, both, or storage.",
        "options": {
          "item": {
            "id": "usb-flash-drive",
            "name": "USB Flash Drive",
            "feedback": "A USB flash drive stores data; it is not classified as an input or output device.",
            "image_path": "/textures/quiz/challenge-2-items/usb-flash-drive.png",
            "model_path": "/models/challenge-2/usb-flash-drive.glb",
            "model_rotation_y": 1.5707963267948966
          },
          "categories": [
            "input",
            "output",
            "both",
            "storage"
          ]
        },
        "correct_answer": {
          "category": "storage"
        }
      },
      {
        "question_order": 5,
        "question_type": "drag_drop",
        "question_text": "Microphone: Classify each device as input, output, both, or storage.",
        "options": {
          "item": {
            "id": "microphone",
            "name": "Microphone",
            "feedback": "A microphone sends recorded sound into the computer.",
            "image_path": "/textures/quiz/challenge-2-items/microphone.png",
            "model_path": "/models/challenge-2/microphone.glb",
            "model_rotation_y": 0
          },
          "categories": [
            "input",
            "output",
            "both",
            "storage"
          ]
        },
        "correct_answer": {
          "category": "input"
        }
      }
    ]
  },
  {
    "title": "Computer Components Challenge",
    "activity_type": "challenge",
    "activity_order": 14,
    "file_path": null,
    "activity_key": "multiple_choice",
    "questions": [
      {
        "question_order": 1,
        "question_type": "multiple_choice",
        "question_text": "Which component provides fast temporary workspace and loses its data when power is turned off?",
        "options": [
          "CPU",
          "RAM",
          "Secondary storage",
          "Output device"
        ],
        "correct_answer": {
          "value": "RAM",
          "choice_index": 1
        }
      },
      {
        "question_order": 2,
        "question_type": "multiple_choice",
        "question_text": "Which feature is a major reason Python powers many modern applications?",
        "options": [
          "It works only with hardware",
          "Its readable syntax and versatile ecosystem",
          "It has no external libraries",
          "It requires machine-code programming"
        ],
        "correct_answer": {
          "value": "Its readable syntax and versatile ecosystem",
          "choice_index": 1
        }
      }
    ]
  },
  {
    "title": "Python Journey Briefing",
    "activity_type": "debrief",
    "activity_order": 15,
    "file_path": "supabase://course-media/csdp-120/week1/images/five-parts-of-every-computer-debrief.png",
    "activity_key": null,
    "questions": []
  },
  {
    "title": "Modern Programming Benefits",
    "activity_type": "debrief",
    "activity_order": 16,
    "file_path": "supabase://course-media/csdp-120/week1/images/loading-and-classification-debrief.png",
    "activity_key": null,
    "questions": []
  },
  {
    "title": "Five Core Computer Components",
    "activity_type": "debrief",
    "activity_order": 17,
    "file_path": "supabase://course-media/csdp-120/week1/images/language-ladder-and-translators-debrief.png",
    "activity_key": null,
    "questions": []
  },
  {
    "title": "Python Puzzle",
    "activity_type": "game",
    "activity_order": 18,
    "file_path": null,
    "activity_key": "python-puzzle",
    "questions": []
  },
  {
    "title": "Display Room",
    "activity_type": "display_room",
    "activity_order": 19,
    "file_path": null,
    "activity_key": "display-room",
    "questions": []
  }
]$content$::jsonb)
 loop
  select * into existing from public.activities where week_id=week and activity_order=(item->>'activity_order')::int;
  if found then
   if existing.title<>item->>'title' or existing.activity_type<>item->>'activity_type' then
    raise exception 'Activity order % is already used; nothing changed.',item->>'activity_order';
   end if;
   activity:=existing.id;
  else
   insert into public.activities(week_id,title,activity_type,activity_order,file_path,activity_key)
   values(week,item->>'title',item->>'activity_type',(item->>'activity_order')::int,item->>'file_path',item->>'activity_key') returning id into activity;
  end if;
  for question in select value from jsonb_array_elements(item->'questions') loop
   insert into public.challenge_questions(activity_id,question_order,question_type,question_text,options,correct_answer)
   values(activity,(question->>'question_order')::int,question->>'question_type',question->>'question_text',question->'options',question->'correct_answer')
   on conflict(activity_id,question_order) do nothing;
  end loop;
 end loop;
end $seed$;
commit;
