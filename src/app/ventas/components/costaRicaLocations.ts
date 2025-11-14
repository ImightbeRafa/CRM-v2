export interface CantonData {
  nombre: string;
  distritos: string[];
}

export interface ProvinceData {
  nombre: string;
  cantones: CantonData[];
}

export const costaRicaLocations: ProvinceData[] = [
  {
    nombre: "San José",
    cantones: [
      {
        nombre: "Central",
        distritos: [
          "Carmen",
          "Merced",
          "Hospital",
          "Catedral",
          "Zapote",
          "San Francisco De Dos Rios",
          "Uruca",
          "Mata Redonda",
          "Pavas",
          "Hatillo",
          "San Sebastián"
        ]
      },
      {
        nombre: "Escazú",
        distritos: ["Escazú", "San Antonio", "San Rafael"]
      },
      {
        nombre: "Desamparados",
        distritos: [
          "Desamparados",
          "San Miguel",
          "San Juan De Dios",
          "San Rafael Arriba",
          "San Rafael Abajo",
          "San Antonio",
          "Frailes",
          "Patarra",
          "San Cristobal",
          "Rosario",
          "Damas",
          "Gravilias",
          "Los Guido"
        ]
      },
      {
        nombre: "Puriscal",
        distritos: [
          "Santiago",
          "Mercedes Sur",
          "Barbacoas",
          "Grifo Alto",
          "San Rafael",
          "Candelarita",
          "Desamparaditos",
          "San Antonio",
          "Chires"
        ]
      },
      {
        nombre: "Tarrazú",
        distritos: ["San Marcos", "San Lorenzo", "San Carlos"]
      },
      {
        nombre: "Aserrí",
        distritos: [
          "Aserrí",
          "Tarbaca",
          "Vuelta De Jorco",
          "San Gabriel",
          "Legua",
          "Monterrey",
          "Salitrillos"
        ]
      },
      {
        nombre: "Mora",
        distritos: ["Colón", "Guayabo", "Tabarcia", "Piedras Negras", "Picagres", "Jaris"]
      },
      {
        nombre: "Goicoechea",
        distritos: [
          "Guadalupe",
          "San Francisco",
          "Calle Blancos",
          "Mata De Platano",
          "Ipís",
          "Rancho Redondo",
          "Purral"
        ]
      },
      {
        nombre: "Santa Ana",
        distritos: ["Santa Ana", "Salitral", "Pozos", "Uruca", "Piedades", "Brasil"]
      },
      {
        nombre: "Alajuelita",
        distritos: ["Alajuelita", "San Josecito", "San Antonio", "Concepción", "San Felipe"]
      },
      {
        nombre: "Vázquez De Coronado",
        distritos: ["San Isidro", "San Rafael", "Dulce Nombre De Jesus", "Patalillo", "Cascajal"]
      },
      {
        nombre: "Acosta",
        distritos: ["San Ignacio", "Guaitil", "Palmichal", "Cangrejal", "Sabanillas"]
      },
      {
        nombre: "Tibás",
        distritos: ["San Juan", "Cinco Esquinas", "Anselmo Llorente", "Leon XIII", "Colima"]
      },
      {
        nombre: "Moravia",
        distritos: ["San Vicente", "San Jeronimo", "La Trinidad"]
      },
      {
        nombre: "Montes De Oca",
        distritos: ["San Pedro", "Sabanilla", "Mercedes", "San Rafael"]
      },
      {
        nombre: "Turrubares",
        distritos: ["San Pablo", "San Pedro", "San Juan De Mata", "San Luis", "Carara"]
      },
      {
        nombre: "Dota",
        distritos: ["Santa María", "Jardin", "Copey"]
      },
      {
        nombre: "Curridabat",
        distritos: ["Curridabat", "Granadilla", "Sanchez", "Tirrases"]
      },
      {
        nombre: "Pérez Zeledón",
        distritos: [
          "San Isidro De El General",
          "El General",
          "Daniel Flores",
          "Rivas",
          "San Pedro",
          "Platanares",
          "Pejibaye",
          "Cajon",
          "Baru",
          "Rio Nuevo",
          "Páramo"
        ]
      },
      {
        nombre: "León Cortés Castro",
        distritos: [
          "San Pablo",
          "San Andres",
          "Llano Bonito",
          "San Isidro",
          "Santa Cruz",
          "San Antonio"
        ]
      }
    ]
  },
  {
    nombre: "Alajuela",
    cantones: [
      {
        nombre: "Central",
        distritos: [
          "Alajuela",
          "San José",
          "Carrizal",
          "San Antonio",
          "Guácima",
          "San Isidro",
          "Sabanilla",
          "San Rafael",
          "Rio Segundo",
          "Desamparados",
          "Turrucares",
          "Tambor",
          "Garita",
          "Sarapiquí"
        ]
      },
      {
        nombre: "San Ramón",
        distritos: [
          "San Ramón",
          "Santiago",
          "San Juan",
          "Piedades Norte",
          "Piedades Sur",
          "San Rafael",
          "San Isidro",
          "Angeles",
          "Alfaro",
          "Volio",
          "Concepción",
          "Zapotal",
          "Peñas Blancas"
        ]
      },
      {
        nombre: "Grecia",
        distritos: ["Grecia", "San Isidro", "San José", "San Roque", "Tacares", "Puente De Piedra", "Bolivar"]
      },
      {
        nombre: "San Mateo",
        distritos: ["San Mateo", "Desmonte", "Jesús María", "Labrador"]
      },
      {
        nombre: "Atenas",
        distritos: ["Atenas", "Jesús", "Mercedes", "San Isidro", "Concepción", "San José", "Santa Eulalia", "Escobal"]
      },
      {
        nombre: "Naranjo",
        distritos: ["Naranjo", "San Miguel", "San José", "Cirrí Sur", "San Jerónimo", "San Juan", "El Rosario", "Palmitos"]
      },
      {
        nombre: "Palmares",
        distritos: ["Palmares", "Zaragoza", "Buenos Aires", "Santiago", "Candelaria", "Esquipulas", "La Granja"]
      },
      {
        nombre: "Poás",
        distritos: ["San Pedro", "San Juan", "San Rafael", "Carrillos", "Sabana Redonda"]
      },
      {
        nombre: "Orotina",
        distritos: ["Orotina", "El Mastate", "Hacienda Vieja", "Coyolar", "La Ceiba"]
      },
      {
        nombre: "San Carlos",
        distritos: [
          "Quesada",
          "Florencia",
          "Buenavista",
          "Aguas Zarcas",
          "Venecia",
          "Pital",
          "La Fortuna",
          "La Tigra",
          "La Palmera",
          "Venado",
          "Cutris",
          "Monterrey",
          "Pocosol"
        ]
      },
      {
        nombre: "Zarcero",
        distritos: ["Zarcero", "Laguna", "Tapesco", "Guadalupe", "Palmira", "Zapote", "Brisas"]
      },
      {
        nombre: "Sarchí",
        distritos: ["Sarchí Norte", "Sarchí Sur", "Toro Amarillo", "San Pedro", "Rodriguez"]
      },
      {
        nombre: "Upala",
        distritos: ["Upala", "Aguas Claras", "San José o Pizote", "Bijagua", "Delicias", "Dos Rios", "Yolillal", "Canalete"]
      },
      {
        nombre: "Los Chiles",
        distritos: ["Los Chiles", "Caño Negro", "El Amparo", "San Jorge"]
      },
      {
        nombre: "Guatuso",
        distritos: ["San Rafael", "Buenavista", "Cote", "Katira"]
      },
      {
        nombre: "Río Cuarto",
        distritos: ["Río Cuarto"]
      }
    ]
  },
  {
    nombre: "Cartago",
    cantones: [
      {
        nombre: "Central",
        distritos: [
          "Oriental",
          "Occidental",
          "Carmen",
          "San Nicolás",
          "Aguacaliente o San Francisco",
          "Guadalupe o Arenilla",
          "Corralillo",
          "Tierra Blanca",
          "Dulce Nombre",
          "Llano Grande",
          "Quebradilla"
        ]
      },
      {
        nombre: "Paraíso",
        distritos: ["Paraíso", "Santiago", "Orosi", "Cachí", "Llanos De Santa Lucía"]
      },
      {
        nombre: "La Unión",
        distritos: ["Tres Ríos", "San Diego", "San Juan", "San Rafael", "Concepción", "Dulce Nombre", "San Ramón", "Río Azul"]
      },
      {
        nombre: "Jiménez",
        distritos: ["Juan Viñas", "Tucurrique", "Pejibaye"]
      },
      {
        nombre: "Turrialba",
        distritos: [
          "Turrialba",
          "La Suiza",
          "Peralta",
          "Santa Cruz",
          "Santa Teresita",
          "Pavones",
          "Tuis",
          "Tayutic",
          "Santa Rosa",
          "Tres Equis",
          "La Isabel",
          "Chirripó"
        ]
      },
      {
        nombre: "Alvarado",
        distritos: ["Pacayas", "Cervantes", "Capellades"]
      },
      {
        nombre: "Oreamuno",
        distritos: ["San Rafael", "Cot", "Potrero Cerrado", "Cipreses", "Santa Rosa"]
      },
      {
        nombre: "El Guarco",
        distritos: ["El Tejar", "San Isidro", "Tobosi", "Patio De Agua"]
      }
    ]
  },
  {
    nombre: "Heredia",
    cantones: [
      {
        nombre: "Central",
        distritos: ["Heredia", "Mercedes", "San Francisco", "Ulloa", "Varablanca"]
      },
      {
        nombre: "Barva",
        distritos: ["Barva", "San Pedro", "San Pablo", "San Roque", "Santa Lucía", "San José De La Montaña"]
      },
      {
        nombre: "Santo Domingo",
        distritos: ["Santo Domingo", "San Vicente", "San Miguel", "Paracito", "Santo Tomás", "Santa Rosa", "Tures", "Para"]
      },
      {
        nombre: "Santa Barbara",
        distritos: ["Santa Bárbara", "San Pedro", "San Juan", "Jesús", "Santo Domingo", "Puraba"]
      },
      {
        nombre: "San Rafael",
        distritos: ["San Rafael", "San Josecito", "Santiago", "Los Ángeles", "Concepción"]
      },
      {
        nombre: "San Isidro",
        distritos: ["San Isidro", "San Josecito", "Concepción", "San Francisco"]
      },
      {
        nombre: "Belén",
        distritos: ["San Antonio", "La Ribera", "La Asunción"]
      },
      {
        nombre: "Flores",
        distritos: ["San Joaquín", "Barrantes", "Llorente"]
      },
      {
        nombre: "San Pablo",
        distritos: ["San Pablo", "Rincón De Sabanilla"]
      },
      {
        nombre: "Sarapiquí",
        distritos: ["Puerto Viejo", "La Virgen", "Las Horquetas", "Llanuras Del Gaspar", "Cureña"]
      }
    ]
  },
  {
    nombre: "Guanacaste",
    cantones: [
      {
        nombre: "Liberia",
        distritos: ["Liberia", "Cañas Dulces", "Mayorga", "Nacascolo", "Curubande"]
      },
      {
        nombre: "Nicoya",
        distritos: ["Nicoya", "Mansion", "San Antonio", "Quebrada Honda", "Sámara", "Nosara", "Belén De Nosarita"]
      },
      {
        nombre: "Santa Cruz",
        distritos: ["Santa Cruz", "Bolsón", "Veintisiete De Abril", "Tempate", "Cabo Velas", "Doria", "Huacas", "Tamarindo", "Cuajiniquil"]
      },
      {
        nombre: "Bagaces",
        distritos: ["Bagaces", "Fortuna", "Mogote", "Rio Naranjo"]
      },
      {
        nombre: "Carrillo",
        distritos: ["Filadelfia", "Palmira", "Sardinal", "Belén"]
      },
      {
        nombre: "Cañas",
        distritos: ["Cañas", "Palmira", "San Miguel", "Bebedero", "Porozal"]
      },
      {
        nombre: "Abangares",
        distritos: ["Las Juntas", "Sierra", "San Juan", "Colorado"]
      },
      {
        nombre: "Tilarán",
        distritos: ["Tilarán", "Quebrada Grande", "Tronadora", "Santa Rosa", "Líbano", "Tierras Morenas", "Arenal"]
      },
      {
        nombre: "Nandayure",
        distritos: ["Carmona", "Santa Rita", "Zapotal", "San Pablo", "Porvenir", "Bejuco"]
      },
      {
        nombre: "La Cruz",
        distritos: ["La Cruz", "Santa Cecilia", "La Garita", "Santa Elena"]
      },
      {
        nombre: "Hojancha",
        distritos: ["Hojancha", "Monte Romo", "Puerto Carrillo", "Huacas", "Matambú"]
      }
    ]
  },
  {
    nombre: "Puntarenas",
    cantones: [
      {
        nombre: "Central",
        distritos: [
          "Puntarenas",
          "Pitahaya",
          "Chomes",
          "Lepanto",
          "Paquera",
          "Manzanillo",
          "Guacimal",
          "Barranca",
          "Monte Verde",
          "Isla Del Coco",
          "Cóbano",
          "Chacarita",
          "Chira",
          "Acapulco",
          "El Roble",
          "Arancibia"
        ]
      },
      {
        nombre: "Esparza",
        distritos: ["Espíritu Santo", "San Juan Grande", "Macacona", "San Rafael", "San Jerónimo", "Caldera"]
      },
      {
        nombre: "Buenos Aires",
        distritos: [
          "Buenos Aires",
          "Volcan",
          "Potrero Grande",
          "Boruca",
          "Pilares",
          "Colinas",
          "Chánguena",
          "Biolley",
          "Brunka"
        ]
      },
      {
        nombre: "Montes De Oro",
        distritos: ["Miramar", "La Unión", "San Isidro"]
      },
      {
        nombre: "Osa",
        distritos: ["Puerto Cortés", "Palmar", "Sierpe", "Bahía Ballena", "Piedras Blancas", "Bahía Drake"]
      },
      {
        nombre: "Quepos",
        distritos: ["Quepos", "Savegre", "Naranjito"]
      },
      {
        nombre: "Golfito",
        distritos: ["Golfito", "Puerto Jiménez", "Guaycará", "Pavón/Pavon"]
      },
      {
        nombre: "Coto Brus",
        distritos: ["San Vito", "Sabalito", "Aguabuena", "Limoncito", "Pittier", "Gutiérrez Braun"]
      },
      {
        nombre: "Parrita",
        distritos: ["Parrita"]
      },
      {
        nombre: "Corredores",
        distritos: ["Corredor", "La Cuesta", "Canoas", "Laurel"]
      },
      {
        nombre: "Garabito",
        distritos: ["Jacó", "Tárcoles"]
      }
    ]
  },
  {
    nombre: "Limón",
    cantones: [
      {
        nombre: "Central",
        distritos: ["Limón", "Valle La Estrella", "Río Blanco", "Matama"]
      },
      {
        nombre: "Pococí",
        distritos: ["Guápiles", "Jiménez", "Rita", "Roxana", "Cariari", "Colorado", "La Colonia"]
      },
      {
        nombre: "Siquirres",
        distritos: ["Siquirres", "Pacuarito", "Florida", "Germania", "El Cairo", "Alegría"]
      },
      {
        nombre: "Talamanca",
        distritos: ["Bratsi", "Sixaola", "Cahuita", "Telire"]
      },
      {
        nombre: "Matina",
        distritos: ["Matina", "Batán", "Carrandi"]
      },
      {
        nombre: "Guácimo",
        distritos: ["Guácimo", "Mercedes", "Pocora", "Río Jiménez", "Duacarí"]
      }
    ]
  }
];

export const provinceNames = costaRicaLocations.map((province) => province.nombre);
