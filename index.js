require('dotenv').config(); // Carga variables de .env

const { 
  Client, GatewayIntentBits, Partials, PermissionsBitField, ChannelType, REST, Routes, SlashCommandBuilder 
} = require("discord.js");

const { TOKEN, CLIENT_ID, GUILD_ID } = process.env;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

// Map por servidor: key = guildId, value = Map(canals)
const servidoresSalas = new Map();

// ====== Slash Commands ======
const commands = [
  new SlashCommandBuilder()
    .setName("sala")
    .setDescription("Crea una sala de voz privada")
    .addIntegerOption(option =>
      option.setName("max")
            .setDescription("Cantidad máxima de miembros")
            .setRequired(true))
    .addStringOption(option => 
      option.setName("nombre")
            .setDescription("Nombre del canal (opcional)")
            .setRequired(false)),

  new SlashCommandBuilder()
    .setName("invitar")
    .setDescription("Invita a un usuario a tu sala")
    .addUserOption(option => option.setName("usuario").setDescription("Usuario a invitar").setRequired(true)),

  new SlashCommandBuilder()
    .setName("expulsar")
    .setDescription("Expulsa a un usuario de tu sala")
    .addUserOption(option => option.setName("usuario").setDescription("Usuario a expulsar").setRequired(true)),

  new SlashCommandBuilder()
    .setName("miembros")
    .setDescription("Lista los miembros actuales de tu sala"),

  new SlashCommandBuilder()
    .setName("cerrar")
    .setDescription("Cierra tu sala manualmente"),
].map(cmd => cmd.toJSON());

// Registrar comandos (globales o para servidor específico)
const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    if (GUILD_ID) {
      // Registro en servidor específico (aparecen al instante)
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log("✅ Comandos slash registrados para el servidor (instantáneo).");
    } else {
      // Registro global (demora hasta 1 hora)
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log("✅ Comandos slash registrados globalmente (pueden tardar hasta 1 hora).");
    }
  } catch (err) { console.error(err); }
})();

// ===== Eventos =====
client.once("ready", () => console.log(`✅ Bot listo como ${client.user.tag}`));

client.on("interactionCreate", async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName, options, guild, member } = interaction;

  // Crear mapa de salas si no existe para el servidor
  if (!servidoresSalas.has(guild.id)) servidoresSalas.set(guild.id, new Map());
  const salas = servidoresSalas.get(guild.id);

  // ===== CREAR SALA =====
  if (commandName === "sala") {
    // Verificar si el usuario ya tiene una sala activa
    const salaExistente = [...salas.values()].find(s => s.dueñoId === member.id);
    if (salaExistente) {
      return interaction.reply({ 
        content: "⚠️ Ya tienes una sala activa. Usa `/cerrar` para cerrar tu sala actual antes de crear una nueva.", 
        ephemeral: true 
      });
    }

    const nombreCanal = options.getString("nombre") || `canal-privado-${member.user.username}`;
    const maxMiembros = options.getInteger("max") || 5;

    // Verificar si ya existe un rol con la misma nomenclatura
    const nombreRol = `Sala-${member.user.username}`;
    let rol = guild.roles.cache.find(r => r.name === nombreRol);
    
    if (!rol) {
      // Crear nuevo rol si no existe
      rol = await guild.roles.create({ name: nombreRol, permissions: [] });
    }
    
    await member.roles.add(rol);

    const canal = await guild.channels.create({
      name: nombreCanal,
      type: ChannelType.GuildVoice,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: rol.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak] },
      ],
    });

    salas.set(canal.id, { dueñoId: member.id, rolId: rol.id, maxMiembros });

    await interaction.reply({ 
      content: `✅ **Sala creada exitosamente!**\n🏷️ Nombre: ${canal.name}\n👑 Dueño: ${member.user.tag}\n👥 Miembros permitidos: ${maxMiembros}\n📅 Expira en 30 días\n\n${canal}`, 
      ephemeral: true 
    });
  }

  // ===== INVITAR =====
  if (commandName === "invitar") {
    const usuario = options.getMember("usuario");
    const sala = [...salas.values()].find(s => s.dueñoId === member.id);
    if (!sala) return interaction.reply({ content: "⚠️ No tienes una sala activa.", ephemeral: true });

    const rol = guild.roles.cache.get(sala.rolId);
    if (rol.members.size >= sala.maxMiembros) return interaction.reply({ content: `⚠️ Se alcanzó el límite de ${sala.maxMiembros} miembros.`, ephemeral: true });

    await usuario.roles.add(rol);
    interaction.reply({ content: `✅ ${usuario} ha sido invitado a tu sala.`, ephemeral: true });
  }

  // ===== EXPULSAR =====
  if (commandName === "expulsar") {
    const usuario = options.getMember("usuario");
    const sala = [...salas.values()].find(s => s.dueñoId === member.id);
    if (!sala) return interaction.reply({ content: "⚠️ No tienes una sala activa.", ephemeral: true });

    const rol = guild.roles.cache.get(sala.rolId);
    await usuario.roles.remove(rol);
    interaction.reply({ content: `🚫 ${usuario} ha sido expulsado de tu sala.`, ephemeral: true });
  }

  // ===== MIEMBROS =====
  if (commandName === "miembros") {
    const sala = [...salas.values()].find(s => s.dueñoId === member.id);
    if (!sala) return interaction.reply({ content: "⚠️ No tienes una sala activa.", ephemeral: true });

    const rol = guild.roles.cache.get(sala.rolId);
    const miembros = rol.members.map(m => m.user.tag);
    interaction.reply({ content: `👥 Miembros actuales de la sala:\n- ${miembros.join("\n- ")}`, ephemeral: true });
  }

  // ===== CERRAR SALA =====
  if (commandName === "cerrar") {
    const salaEntry = [...salas.entries()].find(([id, s]) => s.dueñoId === member.id);
    if (!salaEntry) return interaction.reply({ content: "⚠️ No tienes una sala activa.", ephemeral: true });

    const [canalId, s] = salaEntry;
    const canal = guild.channels.cache.get(canalId);
    const rol = guild.roles.cache.get(s.rolId);
    if (rol) await rol.delete().catch(() => {});
    if (canal) await canal.delete().catch(() => {});
    salas.delete(canalId);

    interaction.reply({ content: `✅ Tu sala ha sido cerrada.`, ephemeral: true });
  }
});

// ===== EVENTO: CANAL ELIMINADO MANUALMENTE =====
client.on("channelDelete", async (canal) => {
  if (canal.type !== ChannelType.GuildVoice) return;
  
  const guild = canal.guild;
  if (!servidoresSalas.has(guild.id)) return;
  
  const salas = servidoresSalas.get(guild.id);
  const sala = salas.get(canal.id);
  
  if (sala) {
    // Eliminar el rol asociado cuando se borra el canal manualmente
    const rol = guild.roles.cache.get(sala.rolId);
    if (rol) await rol.delete().catch(() => {});
    salas.delete(canal.id);
    console.log(`🗑️ Sala ${canal.name} eliminada manualmente - Rol también eliminado.`);
  }
});

// ===== EXPIRACIÓN AUTOMÁTICA 30 DÍAS =====
setInterval(() => {
  const ahora = Date.now();
  servidoresSalas.forEach((salas, guildId) => {
    salas.forEach(async (sala, canalId) => {
      const guild = client.guilds.cache.get(guildId);
      const canal = guild.channels.cache.get(canalId);
      if (!canal) return salas.delete(canalId);

      if (!canal.createdTimestampOriginal) canal.createdTimestampOriginal = canal.createdTimestamp;

      if (ahora - canal.createdTimestampOriginal >= 30 * 24 * 60 * 60 * 1000) {
        const rol = guild.roles.cache.get(sala.rolId);
        if (rol) await rol.delete().catch(() => {});
        await canal.delete().catch(() => {});
        salas.delete(canalId);
        console.log(`🗑️ Sala ${canal.name} eliminada por expirar.`);
      }
    });
  });
}, 60 * 60 * 1000);

client.login(TOKEN);

